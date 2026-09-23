import http from "node:http";
import { parseManualRequestParams, serializeManualRequestParams } from "../../shared/manual-request";
import { parseLocalCacheText } from "../../shared/local-cache";
import { TcpBridgePool } from "../tcp/tcp-bridge";

const MAX_RESPONSE_SIZE = 16 * 1024 * 1024;

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
    if (values !== undefined) return values;
  } catch {
    // Native TZT responses use the readable key=value format below.
  }
  try {
    const values = parseLocalCacheText(responseBody);
    return Object.keys(values).length === 0 ? undefined : values;
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

export function sendManualRequest(options: ManualRequestOptions): Promise<ManualRequestResult> {
  const params = parseManualRequestParams(options.paramsText);
  if (options.transport !== "http") return sendTztRequest(options, params);
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

async function sendTztRequest(options: ManualRequestOptions, params: Record<string, string>): Promise<ManualRequestResult> {
  const started = Date.now();
  const bridge = new TcpBridgePool({ connectTimeoutMs: options.timeoutMs, requestTimeoutMs: options.timeoutMs });
  try {
    const response = await bridge.request({ host: options.host.replace(/^\[|\]$/g, ""), port: options.port }, params);
    return { body: formatTztResponse(response), durationMs: Date.now() - started };
  } finally {
    await bridge.close();
  }
}
