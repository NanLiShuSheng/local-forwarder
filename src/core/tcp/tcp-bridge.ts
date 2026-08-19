import net from "node:net";
import { createTztCodec, type TztCodec, type TztQuery, type TztResponse } from "./tzt-codec";

export interface TcpTarget {
  host: string;
  port: number;
}

export interface TcpBridgeOptions {
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  codec?: TztCodec;
}

interface PendingRequest {
  resolve: (value: TztResponse) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

interface ConnectionState {
  key: string;
  socket: net.Socket;
  buffer: Buffer;
  pending: Map<number, PendingRequest>;
  connected: boolean;
  failed: boolean;
  connectTimer: NodeJS.Timeout;
  connectPromise: Promise<ConnectionState>;
  resolveConnect: (value: ConnectionState) => void;
  rejectConnect: (reason?: unknown) => void;
}

function endpointKey(target: TcpTarget): string {
  return `${target.host}:${target.port}`;
}

export class TcpBridgePool {
  private readonly codec: TztCodec;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly connections = new Map<string, ConnectionState>();
  private serial = 0;
  private closed = false;

  public constructor(options: TcpBridgeOptions) {
    this.codec = options.codec ?? createTztCodec();
    this.connectTimeoutMs = options.connectTimeoutMs;
    this.requestTimeoutMs = options.requestTimeoutMs;
    if (!Number.isFinite(this.connectTimeoutMs) || this.connectTimeoutMs < 0) throw new Error("connectTimeoutMs must be non-negative");
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs < 0) throw new Error("requestTimeoutMs must be non-negative");
  }

  public request(target: TcpTarget, query: TztQuery): Promise<TztResponse> {
    if (this.closed) return Promise.reject(new Error("TCP bridge is closed"));
    if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) return Promise.reject(new Error("Invalid TCP target port"));

    const serial = this.nextSerial();
    const key = endpointKey(target);
    const frame = this.codec.encode(query, serial);
    const connection = this.getOrCreateConnection(target, key);
    return new Promise<TztResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (connection.pending.delete(serial)) reject(new Error(`TCP request timeout for ${key}`));
      }, this.requestTimeoutMs);
      connection.pending.set(serial, { resolve, reject, timer });
      void connection.connectPromise.then(() => {
        if (!connection.failed && connection.pending.has(serial)) connection.socket.write(frame, (error) => {
          if (error) this.failConnection(connection, error);
        });
      }).catch(() => undefined);
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const connections = [...this.connections.values()];
    this.connections.clear();
    for (const connection of connections) this.failConnection(connection, new Error("TCP bridge closed"));
  }

  private nextSerial(): number {
    this.serial = this.serial === 0xffffffff ? 1 : this.serial + 1;
    return this.serial;
  }

  private getOrCreateConnection(target: TcpTarget, key: string): ConnectionState {
    const existing = this.connections.get(key);
    if (existing !== undefined && !existing.failed && !existing.socket.destroyed) return existing;

    const socket = net.createConnection({ host: target.host, port: target.port });
    let resolveConnect!: (value: ConnectionState) => void;
    let rejectConnect!: (reason?: unknown) => void;
    const connectPromise = new Promise<ConnectionState>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });
    const connection: ConnectionState = {
      key,
      socket,
      buffer: Buffer.alloc(0),
      pending: new Map(),
      connected: false,
      failed: false,
      connectTimer: setTimeout(() => this.failConnection(connection, new Error(`TCP connection timeout for ${key}`)), this.connectTimeoutMs),
      connectPromise,
      resolveConnect,
      rejectConnect,
    };
    this.connections.set(key, connection);
    socket.on("connect", () => {
      if (connection.failed) return;
      connection.connected = true;
      clearTimeout(connection.connectTimer);
      connection.resolveConnect(connection);
    });
    socket.on("data", (chunk: Buffer) => this.handleData(connection, chunk));
    socket.on("error", (error) => this.failConnection(connection, error));
    socket.on("close", () => this.failConnection(connection, new Error(`TCP connection closed for ${key}`)));
    return connection;
  }

  private handleData(connection: ConnectionState, chunk: Buffer): void {
    if (connection.failed) return;
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    while (connection.buffer.length >= 6) {
      if (connection.buffer.readUInt16LE(0) !== 0x07b7) {
        this.failConnection(connection, new Error("Invalid TZT frame: bad magic"));
        return;
      }
      const payloadLength = connection.buffer.readUInt32LE(2);
      const frameLength = payloadLength + 6;
      if (frameLength <= 6 || frameLength > 1024 * 1024) {
        this.failConnection(connection, new Error(`Invalid TZT frame length: ${frameLength}`));
        return;
      }
      if (connection.buffer.length < frameLength) return;
      const frame = connection.buffer.subarray(0, frameLength);
      connection.buffer = connection.buffer.subarray(frameLength);
      let response: TztResponse;
      try {
        response = this.codec.decode(frame);
      } catch (error) {
        this.failConnection(connection, error);
        return;
      }
      const serial = Number(response.HandleSerialNo);
      const pending = connection.pending.get(serial);
      // A timed-out request may still have a response in flight. Ignore that
      // valid late frame so it cannot take down unrelated requests sharing the
      // same long-lived connection.
      if (pending === undefined) continue;
      connection.pending.delete(serial);
      clearTimeout(pending.timer);
      delete response.HandleSerialNo;
      pending.resolve(response);
    }
  }

  private failConnection(connection: ConnectionState, reason: unknown): void {
    if (connection.failed) return;
    connection.failed = true;
    clearTimeout(connection.connectTimer);
    if (this.connections.get(connection.key) === connection) this.connections.delete(connection.key);
    if (!connection.connected) connection.rejectConnect(reason);
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    connection.pending.clear();
    if (!connection.socket.destroyed) connection.socket.destroy();
  }
}
