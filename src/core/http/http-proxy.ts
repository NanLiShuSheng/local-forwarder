import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { inflateSync, gunzipSync } from "node:zlib";
import type { AppConfig, ForwardRule, LogEntry } from "../../shared/contracts";
import { decodeCachedResource, type CacheResult } from "../cache/file-cache";
import type { TztCodec } from "../tcp/tzt-codec";
import { matchRule, parseTarget, substituteVariables } from "../routing/rule-matcher";

const MAX_BODY_SIZE = 16 * 1024 * 1024;

export interface TcpBridgeLike {
  request(target: { host: string; port: number }, query: Record<string, string>): Promise<Record<string, string>>;
}

export interface HttpProxyOptions {
  bindHost: string;
  port: number;
  timeoutMs: number;
  rules: ForwardRule[];
  localValues?: Record<string, string>;
  mapValues?: Record<string, string>;
  fileValues?: Record<string, string>;
  accounts?: Record<string, Record<string, string>>;
  tcpTargets?: AppConfig["tcpTargets"];
  tcpBridge?: TcpBridgeLike;
  cache?: ResourceCacheLike;
  cacheConfig?: Pick<AppConfig["cache"], "downloadTarget" | "autoDownload" | "decryptEnabled">;
  cacheCodec?: Pick<TztCodec, "rc4">;
  onLog?: (entry: LogEntry) => void;
}

export interface ResourceCacheLike {
  getOrDownload(relativePath: string, downloader: () => Promise<Uint8Array | Buffer>): Promise<CacheResult>;
  remove(relativePath: string): Promise<void>;
}

export interface HttpProxyAddress {
  host: string;
  port: number;
}

export interface HttpProxyStats {
  requestCount: number;
  successCount: number;
  totalDurationMs: number;
  tcpConnections: number;
}

class RequestTooLargeError extends Error {}

function asMutable(values: Record<string, string> | undefined): Record<string, string> {
  return values ?? Object.create(null) as Record<string, string>;
}

function parseParams(requestUrl: string, body: Buffer): Record<string, string> {
  const url = new URL(requestUrl, "http://local-forwarder.invalid");
  const params = new URLSearchParams(url.search);
  if (body.length > 0) {
    const text = body.toString("utf8");
    for (const [key, value] of new URLSearchParams(text)) params.set(key, value);
  }
  return Object.fromEntries(params.entries());
}

function uppercaseParams(params: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(params)) output[key.toUpperCase()] = value;
  return output;
}

function lookupValue(values: Record<string, string>, key: string): string {
  const wanted = key.toUpperCase();
  for (const [candidate, value] of Object.entries(values)) if (candidate.toUpperCase() === wanted) return value;
  return "";
}

function writeJson(response: ServerResponse, value: unknown, statusCode = 200): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "content-length": body.length });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        request.pause();
        reject(new RequestTooLargeError("request body exceeds 16 MiB"));
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function cleanResponseHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || ["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) continue;
    output[key] = value;
  }
  return output;
}

function decodeResponseBody(data: Buffer, encoding: string | undefined): Buffer {
  if (encoding === undefined) return data;
  const normalized = encoding.toLowerCase().split(",")[0].trim();
  if (normalized === "gzip") return gunzipSync(data);
  if (normalized === "deflate") return inflateSync(data);
  return data;
}

function substituteRequestUrl(input: string, requestUrl: string): string {
  return input.replace(/\$\(url\)|\(\$url\)|%28\$url%29|%28%24url%29/gi, requestUrl);
}

function cacheKeyFor(requestUrl: string): string {
  const request = new URL(requestUrl, "http://local-forwarder.invalid");
  const requestedPath = request.searchParams.get("url") ?? request.pathname;
  if (requestedPath.split(/[\\/]/).some((segment) => segment === "..")) throw new Error("invalid cached resource path");
  const pathOnly = new URL(requestedPath, "http://local-forwarder.invalid").pathname;
  const normalized = pathOnly.replace(/^\/+/, "");
  if (normalized.length === 0 || normalized === "." || normalized.includes("\\")) throw new Error("invalid cached resource path");
  return normalized.toLowerCase().endsWith(".d") ? normalized : `${normalized}.d`;
}

export class HttpProxy {
  private readonly options: HttpProxyOptions;
  private readonly localValues: Record<string, string>;
  private readonly mapValues: Record<string, string>;
  private readonly fileValues: Record<string, string>;
  private readonly accounts: Record<string, Record<string, string>>;
  private server: http.Server | undefined;
  private stats: HttpProxyStats = { requestCount: 0, successCount: 0, totalDurationMs: 0, tcpConnections: 0 };

  public constructor(options: HttpProxyOptions) {
    this.options = options;
    this.localValues = asMutable(options.localValues);
    this.mapValues = asMutable(options.mapValues);
    this.fileValues = asMutable(options.fileValues);
    this.accounts = options.accounts ?? {};
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) throw new Error("timeoutMs must be non-negative");
  }

  public async start(): Promise<HttpProxyAddress> {
    if (this.server !== undefined) {
      const address = this.server.address();
      if (address && typeof address !== "string") return { host: address.address, port: address.port };
    }
    const server = http.createServer((request, response) => void this.handle(request, response));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: this.options.bindHost, port: this.options.port }, () => resolve());
    }).catch((error) => {
      this.server = undefined;
      server.close();
      throw error;
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP server did not provide an address");
    return { host: address.address, port: address.port };
  }

  public async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  public getStats(): HttpProxyStats {
    return { ...this.stats };
  }

  public getValues(): { localValues: Record<string, string>; mapValues: Record<string, string>; fileValues: Record<string, string> } {
    return { localValues: this.localValues, mapValues: this.mapValues, fileValues: this.fileValues };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = Date.now();
    this.stats.requestCount += 1;
    let statusCode = 500;
    try {
      const body = await readBody(request);
      const url = new URL(request.url ?? "/", "http://local-forwarder.invalid");
      if (url.pathname === "/reqlocal") {
        writeJson(response, Object.fromEntries(Object.keys(parseParams(request.url ?? "/", body)).map((key) => [key.toUpperCase(), lookupValue(this.localValues, key)])));
        statusCode = 200;
      } else if (url.pathname === "/reqsavemap" || url.pathname === "/reqreadmap") {
        const params = uppercaseParams(parseParams(request.url ?? "/", body));
        if (url.pathname === "/reqsavemap") {
          Object.assign(this.mapValues, params);
          writeJson(response, { ERRORNO: "0" });
        } else {
          writeJson(response, Object.fromEntries(Object.keys(params).map((key) => [key, lookupValue(this.mapValues, key)])));
        }
        statusCode = 200;
      } else if (url.pathname === "/reqsavefile" || url.pathname === "/reqreadfile") {
        const filename = url.searchParams.get("filename") ?? "";
        if (!filename || filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") {
          writeJson(response, { error: "invalid filename" }, 400);
        } else if (url.pathname === "/reqsavefile") {
          this.fileValues[filename.toUpperCase()] = body.toString("utf8");
          writeJson(response, { ERRORNO: "0" });
        } else {
          const value = this.fileValues[filename.toUpperCase()] ?? "";
          response.writeHead(200, { "content-type": "application/octet-stream" });
          response.end(value);
        }
        statusCode = response.statusCode;
      } else if (url.pathname === "/reqxml" || url.pathname === "/login") {
        await this.handleTcp(request.url ?? "/reqxml", body, response, url.pathname === "/login");
        statusCode = response.statusCode;
      } else {
        await this.forward(request, response, body);
        statusCode = response.statusCode;
      }
      if (statusCode >= 200 && statusCode < 500) this.stats.successCount += 1;
    } catch (error) {
      statusCode = error instanceof RequestTooLargeError ? 413 : 500;
      if (!response.headersSent) writeJson(response, { error: error instanceof Error ? error.message : "request failed" }, statusCode);
    } finally {
      const durationMs = Date.now() - started;
      this.stats.totalDurationMs += durationMs;
      this.options.onLog?.({ timestamp: new Date().toISOString(), level: statusCode >= 500 ? "error" : "info", message: `${request.method ?? "GET"} ${request.url ?? "/"}`, direction: "inbound", protocol: "http", statusCode, durationMs });
    }
  }

  private async handleTcp(route: string, body: Buffer, response: ServerResponse, login = false): Promise<void> {
    if (this.options.tcpBridge === undefined) return writeJson(response, { error: "TCP bridge is unavailable" }, 502);
    let params = parseParams(route, body);
    if (!login) {
      const substituted = substituteVariables(new URLSearchParams(params).toString(), this.localValues);
      params = Object.fromEntries(new URLSearchParams(substituted).entries());
    }
    const normalizedParams = uppercaseParams(params);
    if (login) {
      const type = normalizedParams.TYPE ?? "ptjy";
      Object.assign(params, this.accounts[type] ?? {});
      params.REQLINKTYPE = "1";
    }
    const targets = (this.options.tcpTargets ?? []).filter((target) => target.enabled);
    const index = Number((uppercaseParams(params).REQLINKTYPE ?? 0));
    const target = targets[index] ?? targets[0];
    if (target === undefined) return writeJson(response, { error: "TCP target is unavailable" }, 502);
    try {
      const result = await this.options.tcpBridge.request({ host: target.host, port: target.port }, params);
      writeJson(response, result);
    } catch (error) {
      writeJson(response, { error: error instanceof Error ? error.message : "TCP request failed" }, /timeout/i.test(String(error)) ? 504 : 502);
    }
  }

  private async forward(request: IncomingMessage, response: ServerResponse, body: Buffer): Promise<void> {
    const originalUrl = request.url ?? "/";
    const substitutedUrl = substituteVariables(originalUrl, this.localValues);
    const rule = matchRule(substitutedUrl, this.options.rules);
    if (rule === undefined) return writeJson(response, { error: "No forwarding rule matched" }, 404);
    const target = parseTarget(substituteVariables(rule.target, this.localValues));
    if (target.protocol === "tcp") return writeJson(response, { error: "TCP target requires /reqxml" }, 502);
    if (this.options.cache !== undefined && this.options.cacheConfig?.autoDownload === true && request.method === "GET" && rule.rewrite?.toLowerCase().includes(".d")) {
      await this.serveCachedResource(request, response, rule, substitutedUrl);
      return;
    }
    const outgoingPath = rule.rewrite === undefined ? substitutedUrl : substituteRequestUrl(substituteVariables(rule.rewrite, this.localValues), substitutedUrl);
    const targetPath = target.pathname === "/" ? outgoingPath : `${target.pathname.replace(/\/$/, "")}${outgoingPath.startsWith("/") ? outgoingPath : `/${outgoingPath}`}`;
    const requestHeaders = { ...request.headers };
    delete requestHeaders.connection;
    const client = target.protocol === "https" ? https : http;
    await new Promise<void>((resolve) => {
      const outbound = client.request({ hostname: target.hostname, port: target.port, path: `${targetPath}${target.search}`, method: request.method, headers: requestHeaders, rejectUnauthorized: false }, (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstream.once("end", () => {
          try {
            const decoded = decodeResponseBody(Buffer.concat(chunks), typeof upstream.headers["content-encoding"] === "string" ? upstream.headers["content-encoding"] : undefined);
            const headers = cleanResponseHeaders(upstream.headers);
            response.writeHead(upstream.statusCode ?? 502, headers);
            response.end(decoded);
          } catch {
            writeJson(response, { error: "upstream response decompression failed" }, 502);
          }
          resolve();
        });
      });
      let settled = false;
      const finish = (status: number, message: string) => {
        if (settled) return;
        settled = true;
        outbound.destroy();
        if (!response.headersSent) writeJson(response, { error: message }, status);
        resolve();
      };
      outbound.once("error", () => finish(502, "upstream request failed"));
      outbound.setTimeout(this.options.timeoutMs, () => finish(504, "upstream request timeout"));
      if (body.length > 0) outbound.write(body);
      outbound.end();
    });
  }

  private async serveCachedResource(request: IncomingMessage, response: ServerResponse, rule: ForwardRule, requestUrl: string): Promise<void> {
    const cache = this.options.cache;
    const cacheConfig = this.options.cacheConfig;
    if (cache === undefined || cacheConfig === undefined || cacheConfig.downloadTarget.length === 0) {
      throw new Error("resource cache download target is not configured");
    }
    const cacheKey = cacheKeyFor(requestUrl);
    const target = parseTarget(cacheConfig.downloadTarget);
    if (target.protocol === "tcp") throw new Error("resource cache download target must use HTTP or HTTPS");
    if (target.pathname !== "/" && !target.pathname.toLowerCase().startsWith("/download")) {
      throw new Error("resource cache download target must use the /download prefix");
    }
    const prefix = target.pathname === "/" ? "/download" : target.pathname.replace(/\/$/, "");
    const result = await cache.getOrDownload(cacheKey, async () => this.downloadResource(target, `${prefix}/${cacheKey}`));
    let data: Buffer;
    try {
      if (cacheConfig.decryptEnabled) {
        if (this.options.cacheCodec === undefined) throw new Error("resource cache codec is unavailable");
        data = decodeCachedResource(cacheKey, result.data, this.options.cacheCodec, true);
      } else {
        data = Buffer.from(result.data);
      }
    } catch (error) {
      await cache.remove(cacheKey).catch(() => undefined);
      throw error;
    }
    response.writeHead(200, { "content-type": contentTypeFor(cacheKey), "content-length": data.length });
    if (request.method === "HEAD") response.end();
    else response.end(data);
  }

  private downloadResource(target: ReturnType<typeof parseTarget>, resourcePath: string): Promise<Buffer> {
    const client = target.protocol === "https" ? https : http;
    return new Promise((resolve, reject) => {
      const outbound = client.request({ hostname: target.hostname, port: target.port, path: resourcePath, method: "GET", rejectUnauthorized: false }, (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstream.once("end", () => {
          if (upstream.statusCode !== 200) {
            reject(new Error(`resource download failed with status ${upstream.statusCode ?? "unknown"}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      });
      outbound.once("error", reject);
      outbound.setTimeout(this.options.timeoutMs, () => {
        outbound.destroy();
        reject(new Error("resource download timeout"));
      });
      outbound.end();
    });
  }
}

function contentTypeFor(relativePath: string): string {
  const withoutEncodingSuffix = relativePath.toLowerCase().replace(/\.d$/, "");
  const extension = withoutEncodingSuffix.slice(withoutEncodingSuffix.lastIndexOf("."));
  return ({ ".js": "application/javascript", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" } as Record<string, string>)[extension] ?? "application/octet-stream";
}
