import http from "node:http";
import { parseManualRequestParams, serializeManualRequestParams } from "../../shared/manual-request";
import { hasSuccessfulLoginErrorNo, parseLocalCacheText } from "../../shared/local-cache";
import type { LogEntry, ManualRequestConfig } from "../../shared/contracts";
import { TcpBridgePool } from "../tcp/tcp-bridge";
import type { TztCodec } from "../tcp/tzt-codec";

const MAX_RESPONSE_SIZE = 16 * 1024 * 1024;
const MAX_LOG_DETAIL_SIZE = 256 * 1024;

export interface ManualRequestOptions {
  host: string;
  port: number;
  paramsText: string;
  timeoutMs: number;
  transport?: "tzt" | "http";
}

export interface ManualRequestResult {
  statusCode?: number;
  statusMessage?: string;
  body: string;
  durationMs: number;
}

export interface ManualRequestDependencies {
  tcpBridge?: ManualTcpRequester;
}

export interface ManualTcpRequester {
  request(target: { host: string; port: number }, query: Record<string, string>, timeoutMs: number): Promise<Record<string, unknown>>;
}

export class ManualTcpRequestBridge implements ManualTcpRequester {
  private bridge: TcpBridgePool | undefined;
  private timeoutMs: number | undefined;

  public constructor(private readonly codec: TztCodec) {}

  public async request(target: { host: string; port: number }, query: Record<string, string>, timeoutMs: number) {
    if (this.bridge === undefined || this.timeoutMs !== timeoutMs) {
      const previous = this.bridge;
      this.bridge = new TcpBridgePool({ connectTimeoutMs: timeoutMs, requestTimeoutMs: timeoutMs, codec: this.codec });
      this.timeoutMs = timeoutMs;
      await previous?.close();
    }
    return this.bridge.request(target, query);
  }

  public async close(): Promise<void> {
    const bridge = this.bridge;
    this.bridge = undefined;
    this.timeoutMs = undefined;
    await bridge?.close();
  }
}

function truncateLogDetail(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_LOG_DETAIL_SIZE) return value;
  return `${Buffer.from(value, "utf8").subarray(0, MAX_LOG_DETAIL_SIZE).toString("utf8")}\n…（内容过长，已截取前 ${MAX_LOG_DETAIL_SIZE} 字节）`;
}

export function createManualRequestLogEntry(request: ManualRequestConfig, result: ManualRequestResult): LogEntry {
  const params = parseManualRequestParams(request.paramsText);
  const requestBody = serializeManualRequestParams(params);
  return {
    timestamp: new Date().toISOString(),
    level: result.statusCode !== undefined && result.statusCode >= 500 ? "error" : "info",
    message: "POST /reqxml",
    direction: "outbound",
    protocol: request.transport === "http" ? "http" : "tcp",
    statusCode: result.statusCode,
    durationMs: result.durationMs,
    requestType: "http",
    requestPath: "/reqxml",
    requestParams: truncateLogDetail(`POST /reqxml\n\n${requestBody}`),
    responseData: truncateLogDetail(result.body),
  };
}

const LOGIN_ACTIONS = new Set(["100", "104", "105"]);

function scalarResponseValues(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const values: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") continue;
    values[key.toUpperCase()] = String(entry);
  }
  return Object.keys(values).length === 0 ? undefined : values;
}

export function extractManualLoginValues(paramsText: string, responseBody: string): Record<string, string> | undefined {
  const params = parseManualRequestParams(paramsText);
  const action = Object.entries(params).reverse().find(([key]) => key.toUpperCase() === "ACTION")?.[1]?.trim();
  if (action === undefined || !LOGIN_ACTIONS.has(action)) return undefined;
  try {
    const parsed = JSON.parse(responseBody) as unknown;
    const values = scalarResponseValues(parsed);
    if (values !== undefined) return hasSuccessfulLoginErrorNo(values) ? values : undefined;
  } catch {
    // Native TZT responses use the readable key=value format below.
  }
  try {
    const values = parseLocalCacheText(responseBody);
    if (Object.keys(values).length === 0 || !hasSuccessfulLoginErrorNo(values)) return undefined;
    return values;
  } catch {
    return undefined;
  }
}

function formatTztValue(value: unknown): string {
  if (typeof value === "string") return value.replace(/\u0003/g, "");
  if (value === undefined) return "";
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function formatTztResponse(response: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(response)) {
    const displayKey = key === "Grid0" ? "Grid" : key === "IntactToServer" ? "Intacttoserver" : key;
    if (key === "Grid0" && Array.isArray(value)) {
      const gridLines = value.map((entry) => formatTztValue(entry));
      lines.push(`${displayKey} = ${gridLines.join("\n")}`);
      continue;
    }
    lines.push(`${displayKey} = ${formatTztValue(value)}`);
  }
  return lines.join("\n");
}

export function sendManualRequest(options: ManualRequestOptions, dependencies: ManualRequestDependencies = {}): Promise<ManualRequestResult> {
  const params = parseManualRequestParams(options.paramsText);
  if (options.transport !== "http") return sendTztRequest(options, params, dependencies);
  const body = serializeManualRequestParams(params);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };
    const request = http.request({
      hostname: options.host.replace(/^\[|\]$/g, ""),
      port: options.port,
      path: "/reqxml",
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_SIZE) {
          response.destroy();
          finish(() => reject(new Error("应答内容超过 16 MiB 限制")));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => finish(() => resolve({
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        body: Buffer.concat(chunks).toString("utf8"),
        durationMs: Date.now() - started,
      })));
      response.once("error", (error) => finish(() => reject(error)));
    });
    request.once("error", (error) => finish(() => reject(error)));
    request.setTimeout(options.timeoutMs, () => {
      request.destroy();
      finish(() => reject(new Error("请求超时")));
    });
    request.end(body);
  });
}

async function sendTztRequest(options: ManualRequestOptions, params: Record<string, string>, dependencies: ManualRequestDependencies): Promise<ManualRequestResult> {
  const started = Date.now();
  const ownedBridge = dependencies.tcpBridge === undefined
    ? new TcpBridgePool({ connectTimeoutMs: options.timeoutMs, requestTimeoutMs: options.timeoutMs })
    : undefined;
  const bridge: ManualTcpRequester = dependencies.tcpBridge ?? {
    request: (target, query) => ownedBridge!.request(target, query),
  };
  try {
    const response = await bridge.request({ host: options.host.replace(/^\[|\]$/g, ""), port: options.port }, params, options.timeoutMs);
    return { body: formatTztResponse(response), durationMs: Date.now() - started };
  } finally {
    await ownedBridge?.close();
  }
}
