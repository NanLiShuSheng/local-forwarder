import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type TztValue = string | number | boolean;
export type TztQuery = Record<string, TztValue>;
export type TztResponse = Record<string, unknown>;
export type Awaitable<T> = T | Promise<T>;

export interface TztCodec {
  rc4(data: Uint8Array, key: string): Awaitable<Buffer>;
  rc4Batch(data: Uint8Array[], key: string): Awaitable<Buffer[]>;
  encode(query: TztQuery, serial: number): Awaitable<Buffer>;
  decode(frame: Uint8Array): Awaitable<TztResponse>;
  close?(): Awaitable<void>;
}

interface LegacyRequest {
  method: "rc4" | "rc4batch" | "jsonltzt" | "tztljson";
  data?: string | string[];
  key?: string;
  query?: TztQuery;
  handleSerialNo?: number;
  host?: string;
}

interface LegacyResponse {
  data: string | string[] | unknown[];
}

interface HelperResponse {
  id?: number;
  data?: string | string[] | unknown[];
  error?: string;
}

interface PendingInvocation {
  resolve: (value: LegacyResponse) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

const MAGIC = 0x07b7;
const HEADER_SIZE = 6;
const MAX_FRAME_SIZE = 64 * 1024 * 1024;
const MAX_HELPER_RESPONSE_SIZE = 128 * 1024 * 1024;
const CODEC_CALL_TIMEOUT_MS = 30_000;
const FIXED_FRAME = "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172";
const FIXED_FILE_RC4 = "7ad9f940a0c3d07a8f";
const FIXED_X_RC4 = "32da9e2ceaea1a6e75";

function protocolDirectory(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.TZT_PROTOCOL_DIR,
    resourcesPath === undefined ? undefined : path.join(resourcesPath, "protocol"),
    path.resolve(__dirname, "../../../resources/protocol"),
    path.resolve(process.cwd(), "resources/protocol"),
  ].filter((candidate): candidate is string => candidate !== undefined);

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "tzt-node16-helper.js")) && existsSync(path.join(candidate, "tzt.bytecode-16.13.0"))) return candidate;
  }
  throw new Error("TZT codec runtime incompatible: bundled resources/protocol assets are missing");
}

export function getNode16BinaryCandidates(
  protocolDir: string,
  platform: NodeJS.Platform,
  arch: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const bundled = platform === "win32" && arch === "x64"
    ? [path.join(protocolDir, "node", "win-x64", "node.exe")]
    : platform === "darwin" && arch === "x64"
      ? [path.join(protocolDir, "node", "macos-x64", "node")]
      : platform === "darwin" && arch === "arm64"
        ? [path.join(protocolDir, "node", "macos-arm64", "node")]
        : [];
  const external = [
    path.join(os.homedir(), ".nvm/versions/node/v16.13.0/bin/node"),
    env.NVM_BIN === undefined ? undefined : path.join(env.NVM_BIN, "node"),
    platform === "win32" && env.NVM_HOME !== undefined ? path.join(env.NVM_HOME, "v16.13.0", "node.exe") : undefined,
    platform === "win32" && env.APPDATA !== undefined ? path.join(env.APPDATA, "nvm", "v16.13.0", "node.exe") : undefined,
  ].filter((candidate): candidate is string => candidate !== undefined);
  return [env.TZT_NODE16_BIN, ...bundled, ...external].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
}

function node16Binary(): string {
  const protocolDir = protocolDirectory();
  const candidates = getNode16BinaryCandidates(protocolDir, process.platform, process.arch, process.env);

  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next explicitly supported runtime location.
    }
  }
  throw new Error(`TZT codec runtime incompatible: Node.js 16.13.0 is required to load the bundled legacy protocol bytecode; set TZT_NODE16_BIN. Checked: ${candidates.join(", ")}`);
}

class PersistentLegacyRuntime {
  private child: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<number, PendingInvocation>();
  private nextId = 1;
  private checked: Promise<void> | undefined;
  private closed = false;

  public async invoke(request: LegacyRequest): Promise<LegacyResponse> {
    await this.ensureCompatibility();
    return this.invokeRaw(request);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error("TZT codec runtime closed"));
    const child = this.child;
    this.child = undefined;
    if (child === undefined) return;
    child.stdin.end();
    child.kill();
    await Promise.race([
      once(child, "exit").then(() => undefined, () => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }

  private ensureCompatibility(): Promise<void> {
    if (this.checked === undefined) {
      this.checked = this.checkCompatibility().catch((error: unknown) => {
        this.checked = undefined;
        throw error;
      });
    }
    return this.checked;
  }

  private async checkCompatibility(): Promise<void> {
    const fileResult = decodeBase64Response(await this.invokeRaw({ method: "rc4", data: Buffer.from("Plaintext").toString("base64"), key: "file" }));
    const xResult = decodeBase64Response(await this.invokeRaw({ method: "rc4", data: Buffer.from("Plaintext").toString("base64"), key: "x" }));
    const batchResult = decodeBase64BatchResponse(await this.invokeRaw({
      method: "rc4batch",
      data: [Buffer.from("Plaintext").toString("base64")],
      key: "file",
    }), 1);
    const frame = decodeBase64Response(await this.invokeRaw({ method: "jsonltzt", query: { Action: "100", foo: "bar" }, handleSerialNo: 12 }));
    if (fileResult.toString("hex") !== FIXED_FILE_RC4 || xResult.toString("hex") !== FIXED_X_RC4 || batchResult[0]?.toString("hex") !== FIXED_FILE_RC4 || frame.toString("hex") !== FIXED_FRAME) {
      throw new Error("TZT codec runtime incompatible: bundled legacy protocol failed its fixed regression vectors");
    }
  }

  private async invokeRaw(request: LegacyRequest): Promise<LegacyResponse> {
    if (this.closed) throw new Error("TZT codec runtime closed");
    const child = this.getChild();
    const id = this.nextId;
    this.nextId = this.nextId === 0xffffffff ? 1 : this.nextId + 1;
    const response = new Promise<LegacyResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error("TZT codec helper request timed out"));
      }, CODEC_CALL_TIMEOUT_MS);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      child.stdin.write(`${JSON.stringify({ ...request, id })}\n`);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending !== undefined) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      throw error;
    }
    return response;
  }

  private getChild(): ChildProcessWithoutNullStreams {
    if (this.closed) throw new Error("TZT codec runtime closed");
    if (this.child !== undefined) return this.child;
    const protocolDir = protocolDirectory();
    const child = spawn(node16Binary(), [path.join(protocolDir, "tzt-node16-helper.js"), "--server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleStdout(child, chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-8192);
    });
    child.stdin.on("error", (error) => this.handleChildFailure(child, error));
    child.once("error", (error) => this.handleChildFailure(child, error));
    child.once("exit", (code, signal) => {
      const detail = this.stderrBuffer.trim();
      this.handleChildFailure(child, new Error(`TZT codec helper exited (${code ?? signal ?? "unknown"})${detail.length > 0 ? `: ${detail}` : ""}`));
    });
    return child;
  }

  private handleStdout(child: ChildProcessWithoutNullStreams, chunk: string): void {
    if (this.child !== child) return;
    this.stdoutBuffer += chunk;
    if (this.stdoutBuffer.length > MAX_HELPER_RESPONSE_SIZE) {
      this.handleChildFailure(child, new Error("TZT codec helper response exceeded the size limit"));
      return;
    }
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.length > 0) this.handleResponseLine(child, line);
      if (this.child !== child) return;
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private handleResponseLine(child: ChildProcessWithoutNullStreams, line: string): void {
    let response: HelperResponse;
    try {
      response = JSON.parse(line) as HelperResponse;
    } catch (error) {
      this.handleChildFailure(child, new Error("TZT codec helper returned invalid JSON", { cause: error }));
      return;
    }
    if (typeof response.id !== "number") {
      this.handleChildFailure(child, new Error("TZT codec helper returned a response without an id"));
      return;
    }
    const pending = this.pending.get(response.id);
    if (pending === undefined) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error !== undefined) pending.reject(new Error(response.error));
    else pending.resolve({ data: response.data ?? [] });
  }

  private handleChildFailure(child: ChildProcessWithoutNullStreams, reason: unknown): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.stdoutBuffer = "";
    this.rejectAll(reason instanceof Error ? reason : new Error(String(reason)));
    if (!child.killed) child.kill();
  }

  private rejectAll(reason: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

function decodeBase64Response(response: LegacyResponse): Buffer {
  if (typeof response.data !== "string") throw new Error("TZT codec runtime incompatible: expected a base64 response");
  return Buffer.from(response.data, "base64");
}

function decodeBase64BatchResponse(response: LegacyResponse, expectedLength: number): Buffer[] {
  if (!Array.isArray(response.data) || response.data.length !== expectedLength) {
    throw new Error("TZT codec runtime incompatible: expected a base64 batch response");
  }
  return response.data.map((entry) => {
    if (typeof entry !== "string") throw new Error("TZT codec runtime incompatible: expected a base64 batch response");
    return Buffer.from(entry, "base64");
  });
}

function assertFrameShape(frame: Uint8Array): Buffer {
  const bytes = Buffer.from(frame);
  if (bytes.length < HEADER_SIZE) throw new Error("Invalid TZT frame: truncated header");
  if (bytes.readUInt16LE(0) !== MAGIC) throw new Error("Invalid TZT frame: bad magic");
  const payloadLength = bytes.readUInt32LE(2);
  if (payloadLength < 11 || payloadLength > MAX_FRAME_SIZE) throw new Error(`Invalid TZT frame length: ${payloadLength + HEADER_SIZE}`);
  if (bytes.length !== payloadLength + HEADER_SIZE) throw new Error("Invalid TZT frame: truncated or extra bytes");
  return bytes;
}

function decodeLegacyResponse(value: unknown): TztResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid TZT response: expected an object");
  const result = { ...(value as Record<string, unknown>) };
  delete result.zzkeyByte;
  delete result.zzbytes;
  if (result.HandleSerialNo === undefined) throw new Error("Invalid TZT response: missing serial number");
  if (typeof result.HandleSerialNo !== "string" && typeof result.HandleSerialNo !== "number") throw new Error("Invalid TZT response: invalid serial number");
  return result;
}

export function createTztCodec(): TztCodec {
  const runtime = new PersistentLegacyRuntime();

  return {
    async rc4(data, key) {
      return decodeBase64Response(await runtime.invoke({ method: "rc4", data: Buffer.from(data).toString("base64"), key }));
    },
    async rc4Batch(data, key) {
      if (data.length === 0) return [];
      return decodeBase64BatchResponse(await runtime.invoke({
        method: "rc4batch",
        data: data.map((entry) => Buffer.from(entry).toString("base64")),
        key,
      }), data.length);
    },
    async encode(query, serial) {
      if (!Number.isSafeInteger(serial) || serial < 0 || serial > 0xffffffff) throw new Error(`Invalid TZT serial number: ${serial}`);
      return decodeBase64Response(await runtime.invoke({ method: "jsonltzt", query, handleSerialNo: serial }));
    },
    async decode(frame) {
      const bytes = assertFrameShape(frame);
      const response = await runtime.invoke({ method: "tztljson", data: bytes.toString("base64"), host: "local-forwarder" });
      if (!Array.isArray(response.data) || response.data.length !== 1) throw new Error("Invalid TZT frame: legacy decoder returned no single response");
      return decodeLegacyResponse(response.data[0]);
    },
    close: () => runtime.close(),
  };
}

export interface TztCodecPoolOptions {
  maxWorkers?: number;
  createCodec?: () => TztCodec;
}

interface TztCodecWorker {
  codec: TztCodec;
  active: number;
}

export function createTztCodecPool(options: TztCodecPoolOptions = {}): TztCodec {
  const maxWorkers = options.maxWorkers ?? 2;
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1) throw new Error("TZT codec pool size must be a positive integer");
  const createCodec = options.createCodec ?? createTztCodec;
  const workers: TztCodecWorker[] = [];
  let closed = false;
  let closing: Promise<void> | undefined;

  const selectWorker = (): TztCodecWorker => {
    if (closed) throw new Error("TZT codec pool closed");
    let worker = workers.find((candidate) => candidate.active === 0);
    if (worker === undefined && workers.length < maxWorkers) {
      worker = { codec: createCodec(), active: 0 };
      workers.push(worker);
    }
    if (worker === undefined) {
      worker = workers.reduce((leastBusy, candidate) => candidate.active < leastBusy.active ? candidate : leastBusy);
    }
    return worker;
  };

  const invoke = async <T>(operation: (codec: TztCodec) => Awaitable<T>): Promise<T> => {
    const worker = selectWorker();
    worker.active += 1;
    try {
      return await operation(worker.codec);
    } finally {
      worker.active -= 1;
    }
  };

  return {
    rc4: (data, key) => invoke((codec) => codec.rc4(data, key)),
    rc4Batch: (data, key) => invoke((codec) => codec.rc4Batch(data, key)),
    encode: (query, serial) => invoke((codec) => codec.encode(query, serial)),
    decode: (frame) => invoke((codec) => codec.decode(frame)),
    close: () => {
      if (closing !== undefined) return closing;
      closed = true;
      closing = Promise.allSettled(workers.map(async (worker) => worker.codec.close?.())).then(() => undefined);
      return closing;
    },
  };
}
