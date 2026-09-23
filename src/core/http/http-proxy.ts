import { readFile, stat } from "node:fs/promises";
import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import path from "node:path";
import { inflateSync, gunzipSync } from "node:zlib";
import type { AppConfig, ForwardRule, LogEntry } from "../../shared/contracts";
import { decodeCachedResource, rewriteLegacyNavigationScript, type CacheResult } from "../cache/file-cache";
import type { TztCodec } from "../tcp/tzt-codec";
import { matchRule, parseTarget, substituteVariables } from "../routing/rule-matcher";

const MAX_BODY_SIZE = 16 * 1024 * 1024;
const MAX_LOG_DETAIL_SIZE = 256 * 1024;

export interface TcpBridgeLike {
  request(target: { host: string; port: number }, query: Record<string, string>): Promise<Record<string, unknown>>;
}

export interface HttpProxyOptions {
  bindHost: string;
  port: number;
  timeoutMs: number;
  projectPath?: string;
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
  onLocalValuesChanged?: (values: Record<string, string>) => void;
  onLoginValuesChanged?: (values: Record<string, string>) => void;
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

interface ResponseCapture {
  chunks: Buffer[];
  totalBytes: number;
}

function requestTypeFor(request: IncomingMessage): LogEntry["requestType"] {
  const fetchDestination = typeof request.headers["sec-fetch-dest"] === "string" ? request.headers["sec-fetch-dest"].toLowerCase() : "";
  const requestedWith = typeof request.headers["x-requested-with"] === "string" ? request.headers["x-requested-with"].toLowerCase() : "";
  if (requestedWith === "xmlhttprequest") return "xhr";
  if (fetchDestination === "empty") return "fetch";
  return undefined;
}

function requestPathFor(requestUrl: string | undefined): string | undefined {
  try {
    return new URL(requestUrl ?? "/", "http://local-forwarder.invalid").pathname || "/";
  } catch {
    return undefined;
  }
}

function captureResponse(response: ServerResponse): ResponseCapture {
  const capture: ResponseCapture = { chunks: [], totalBytes: 0 };
  const responseWithOverrides = response as any;
  const originalWrite = responseWithOverrides.write.bind(response);
  const originalEnd = responseWithOverrides.end.bind(response);
  const remember = (chunk: unknown, encoding?: unknown) => {
    if (chunk === undefined || typeof chunk === "function") return;
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : Buffer.from(String(chunk), typeof encoding === "string" ? encoding as BufferEncoding : "utf8");
    capture.totalBytes += buffer.length;
    if (capture.totalBytes <= MAX_LOG_DETAIL_SIZE) capture.chunks.push(buffer);
    else if (capture.totalBytes - buffer.length < MAX_LOG_DETAIL_SIZE) capture.chunks.push(buffer.subarray(0, MAX_LOG_DETAIL_SIZE - (capture.totalBytes - buffer.length)));
  };
  responseWithOverrides.write = (...args: any[]) => { remember(args[0], args[1]); return originalWrite(...args); };
  responseWithOverrides.end = (...args: any[]) => { remember(args[0], args[1]); return originalEnd(...args); };
  return capture;
}

function truncateLogDetail(value: string, totalBytes = Buffer.byteLength(value, "utf8")): string {
  if (totalBytes <= MAX_LOG_DETAIL_SIZE) return value;
  return `${value}\n…（内容过长，已截取前 ${MAX_LOG_DETAIL_SIZE} 字节）`;
}

function requestParamsFor(request: IncomingMessage, body: Buffer): string {
  const requestLine = `${request.method ?? "GET"} ${request.url ?? "/"}`;
  if (body.length === 0) return requestLine;
  return truncateLogDetail(`${requestLine}\n\n${body.toString("utf8")}`);
}

function responseDataFor(response: ServerResponse, capture: ResponseCapture): string {
  if (capture.totalBytes === 0) return "";
  const contentType = String(response.getHeader("content-type") ?? "").toLowerCase();
  if (contentType.length > 0 && !/(text|json|javascript|xml|x-www-form-urlencoded)/i.test(contentType)) return `[二进制响应，共 ${capture.totalBytes} 字节]`;
  return truncateLogDetail(Buffer.concat(capture.chunks).toString("utf8"), capture.totalBytes);
}

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

interface LegacyActionResponse {
  statusCode: 200 | 204 | 301 | 307;
  location?: string;
  body?: string;
}

const actionTokenPattern = /(?:^|\/)action:(\d+)(?:[/?#]|$)/i;
const actionHostPattern = /^action:(\d+)$/i;

function actionCodeFor(requestUrl: string, hostHeader?: string | string[]): string | undefined {
  const urlMatch = actionTokenPattern.exec(requestUrl);
  if (urlMatch?.[1] !== undefined) return urlMatch[1];
  const host = Array.isArray(hostHeader) ? hostHeader[0] ?? "" : hostHeader ?? "";
  return actionHostPattern.exec(host.trim())?.[1];
}

function isActionInvocationPath(requestUrl: string): boolean {
  const pathname = new URL(requestUrl, "http://local-forwarder.invalid").pathname;
  return pathname === "/" || /^\/action:\d+(?:\/|$)/i.test(pathname);
}

function resolveActionTarget(requestUrl: string, hostHeader?: string | string[]): string | undefined {
  let currentUrl = requestUrl;
  let currentHost = hostHeader;
  for (let depth = 0; depth < 8; depth += 1) {
    if (actionCodeFor(currentUrl, currentHost) === undefined) return undefined;
    const target = new URL(currentUrl, "http://local-forwarder.invalid").searchParams.get("url");
    if (target === null) return undefined;
    const cleanedTarget = target.replace(/[\u4e00-\u9fa5]/g, "");
    if (actionCodeFor(cleanedTarget) === undefined) return cleanedTarget;
    currentUrl = cleanedTarget;
    currentHost = undefined;
  }
  return undefined;
}

function legacyActionResponse(requestUrl: string, hostHeader?: string | string[]): LegacyActionResponse | undefined {
  const actionCode = actionCodeFor(requestUrl, hostHeader);
  if (actionCode === undefined) return undefined;

  if (actionCode === "10002" && isActionInvocationPath(requestUrl)) {
    return {
      statusCode: 200,
      body: "<html><head><meta http-equiv=Content-Type><script type=text/javascript>window.history.go(-2);</script><body><html>",
    };
  }

  const target = resolveActionTarget(requestUrl, hostHeader);
  if (target !== undefined) return { statusCode: actionCode === "1964" ? 301 : 307, location: target };
  if (isActionInvocationPath(requestUrl)) return { statusCode: 204 };
  return undefined;
}

function uppercaseParams(params: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(params)) output[key.toUpperCase()] = value;
  return output;
}

function uppercaseRecordKeys(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(record)) output[key.toUpperCase()] = value;
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

function uppercaseJsonKeys(data: Buffer, contentType: string | string[] | undefined): Buffer {
  const header = Array.isArray(contentType) ? contentType.join(",") : contentType ?? "";
  if (/application\/binary/i.test(header) || /charset\s*=\s*gbk/i.test(header)) return data;
  try {
    const parsed: unknown = JSON.parse(data.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return data;
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) output[key.toUpperCase()] = value;
    return Buffer.from(JSON.stringify(output), "utf8");
  } catch {
    return data;
  }
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

function joinProjectPath(rootDir: string, requestPath: string): { absolute: string; relative: string } {
  const pathname = decodeURIComponent(new URL(requestPath, "http://local-forwarder.invalid").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const root = path.resolve(rootDir);
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) throw new Error("project path escapes configured directory");
  return { absolute, relative };
}

export class HttpProxy {
  private readonly options: HttpProxyOptions;
  private readonly localValues: Record<string, string>;
  private readonly mapValues: Record<string, string>;
  private readonly fileValues: Record<string, string>;
  private readonly accounts: Record<string, Record<string, string>>;
  private server: http.Server | undefined;
  private readonly outboundRequests = new Set<http.ClientRequest>();
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
    for (const outbound of this.outboundRequests) outbound.destroy();
    if (server === undefined) return;
    server.closeAllConnections();
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
    const requestType = requestTypeFor(request);
    const requestPath = requestPathFor(request.url);
    const responseCapture = captureResponse(response);
    this.stats.requestCount += 1;
    let requestBody: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let statusCode = 500;
    try {
      const body = await readBody(request);
      requestBody = body;
      const url = new URL(request.url ?? "/", "http://local-forwarder.invalid");
      const actionResponse = legacyActionResponse(request.url ?? "/", request.headers.host);
      if (actionResponse !== undefined) {
        if (actionResponse.location !== undefined) {
          response.writeHead(actionResponse.statusCode, { location: actionResponse.location });
          response.end();
        } else if (actionResponse.body !== undefined) {
          response.writeHead(actionResponse.statusCode, { "content-type": "text/html" });
          response.end(actionResponse.body);
        } else {
          response.writeHead(actionResponse.statusCode);
          response.end();
        }
        statusCode = actionResponse.statusCode;
      } else if (url.pathname === "/reqlocal") {
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
        await this.handleTcp(request.url ?? "/reqxml", body, response, url.pathname === "/login", request.method ?? "GET", request.headers);
        statusCode = response.statusCode;
      } else if (await this.serveProjectFile(url.pathname, response)) {
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
      if (requestType !== undefined) {
        this.options.onLog?.({ timestamp: new Date().toISOString(), level: statusCode >= 500 ? "error" : "info", message: `${request.method ?? "GET"} ${request.url ?? "/"}`, direction: "inbound", protocol: "http", statusCode, durationMs, requestType, requestPath, requestParams: requestParamsFor(request, requestBody), responseData: responseDataFor(response, responseCapture) });
      }
    }
  }

  private async handleTcp(route: string, body: Buffer, response: ServerResponse, login = false, method = "GET", headers: IncomingHttpHeaders = {}): Promise<void> {
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
      const substituted = substituteVariables(new URLSearchParams(params).toString(), this.localValues);
      params = Object.fromEntries(new URLSearchParams(substituted).entries());
    }
    const targets = (this.options.tcpTargets ?? []).filter((target) => target.enabled);
    const index = Number((uppercaseParams(params).REQLINKTYPE ?? 1));
    const target = targets[index] ?? targets[0];
    if (target === undefined) return writeJson(response, { error: "TCP target is unavailable" }, 502);
    if (target.transport === "http") {
      await this.forwardReqxmlOverHttp(target, route, params, response, method, headers, login);
      return;
    }
    if (this.options.tcpBridge === undefined) return writeJson(response, { error: "TCP bridge is unavailable" }, 502);
    try {
      const result = await this.options.tcpBridge.request({ host: target.host, port: target.port }, params);
      const normalized = uppercaseRecordKeys(result);
      this.captureLocalValues(normalized);
      writeJson(response, normalized);
    } catch (error) {
      writeJson(response, { error: error instanceof Error ? error.message : "TCP request failed" }, /timeout/i.test(String(error)) ? 504 : 502);
    }
  }

  private async forwardReqxmlOverHttp(target: NonNullable<HttpProxyOptions["tcpTargets"]>[number], route: string, params: Record<string, string>, response: ServerResponse, method: string, headers: IncomingHttpHeaders, login: boolean): Promise<void> {
    const requestUrl = new URL(route, "http://local-forwarder.invalid");
    const requestPath = login ? "/reqxml" : requestUrl.pathname;
    const basePath = target.basePath ?? "";
    const targetPath = `${basePath}${requestPath.startsWith("/") ? requestPath : `/${requestPath}`}`;
    const query = new URLSearchParams(params).toString();
    const outgoingPath = method === "GET" && query.length > 0 ? `${targetPath}?${query}` : targetPath;
    const outgoingHeaders = { ...headers, host: target.host };
    delete outgoingHeaders.connection;
    delete outgoingHeaders["content-length"];
    if (method !== "GET") {
      outgoingHeaders["content-type"] ??= "application/x-www-form-urlencoded";
      outgoingHeaders["content-length"] = String(Buffer.byteLength(query));
    }
    const client = target.protocol === "https" ? https : http;
    await new Promise<void>((resolve) => {
      const outbound = this.trackOutbound(client.request({ hostname: target.host, port: target.port, path: outgoingPath, method, headers: outgoingHeaders, rejectUnauthorized: false }, (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstream.once("end", () => {
          const data = uppercaseJsonKeys(
            decodeResponseBody(Buffer.concat(chunks), typeof upstream.headers["content-encoding"] === "string" ? upstream.headers["content-encoding"] : undefined),
            upstream.headers["content-type"],
          );
          this.captureLocalValues(data);
          response.writeHead(upstream.statusCode ?? 502, cleanResponseHeaders(upstream.headers));
          response.end(data);
          resolve();
        });
        upstream.once("error", () => finish(502, "upstream request failed"));
        upstream.once("aborted", () => finish(502, "upstream request failed"));
      }));
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
      if (method !== "GET") outbound.write(query);
      outbound.end();
    });
  }

  private captureLocalValues(value: unknown): void {
    let record: Record<string, unknown> | undefined;
    if (Buffer.isBuffer(value)) {
      try { record = JSON.parse(value.toString("utf8")) as Record<string, unknown>; } catch { return; }
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      record = value as Record<string, unknown>;
    }
    if (record === undefined) return;
    const normalized = uppercaseParams(Object.fromEntries(Object.entries(record).filter(([, entry]) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean").map(([key, entry]) => [key, String(entry)])));
    let changed = false;
    let captured: Record<string, string> = {};
    if (normalized.ACTION === "100") {
      for (const [key, entry] of Object.entries(normalized)) {
        if (this.localValues[key] !== entry) { this.localValues[key] = entry; changed = true; }
        captured[key] = entry;
      }
    } else if (normalized.TOKEN !== undefined && this.localValues.TOKEN !== normalized.TOKEN) {
      this.localValues.TOKEN = normalized.TOKEN;
      changed = true;
      captured.TOKEN = normalized.TOKEN;
    }
    if (changed) {
      this.options.onLoginValuesChanged?.({ ...captured });
      this.options.onLocalValuesChanged?.({ ...this.localValues });
    }
  }

  private async serveProjectFile(requestPath: string, response: ServerResponse): Promise<boolean> {
    if (!this.options.projectPath) return false;
    const paths = joinProjectPath(this.options.projectPath, requestPath);
    let actual = paths.absolute;
    try {
      const details = await stat(actual);
      if (!details.isFile()) return false;
    } catch {
      const encoded = `${actual}.d`;
      try {
        const details = await stat(encoded);
        if (!details.isFile()) return false;
        actual = encoded;
      } catch {
        return false;
      }
    }
    let data: Buffer = Buffer.from(await readFile(actual));
    if (actual.endsWith(".d") && this.options.cacheCodec !== undefined) data = Buffer.from(decodeCachedResource(paths.relative, data, this.options.cacheCodec, true));
    if (!actual.endsWith(".d") || this.options.cacheCodec !== undefined) data = rewriteLegacyNavigationScript(paths.relative, data);
    response.writeHead(200, { "content-type": contentTypeFor(paths.relative), "content-length": data.length });
    response.end(data);
    return true;
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
    const outgoingBody = body.length === 0
      ? body
      : Buffer.from(substituteVariables(body.toString("utf8"), this.localValues), "utf8");
    const outgoingPath = rule.rewrite === undefined ? substitutedUrl : substituteRequestUrl(substituteVariables(rule.rewrite, this.localValues), substitutedUrl);
    const targetPath = target.pathname === "/" ? outgoingPath : `${target.pathname.replace(/\/$/, "")}${outgoingPath.startsWith("/") ? outgoingPath : `/${outgoingPath}`}`;
    const requestHeaders = { ...request.headers };
    delete requestHeaders.connection;
    if (outgoingBody.length > 0) requestHeaders["content-length"] = String(outgoingBody.length);
    const client = target.protocol === "https" ? https : http;
    await new Promise<void>((resolve) => {
      const outbound = this.trackOutbound(client.request({ hostname: target.hostname, port: target.port, path: `${targetPath}${target.search}`, method: request.method, headers: requestHeaders, rejectUnauthorized: false }, (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstream.once("end", () => {
          try {
            const decoded = uppercaseJsonKeys(
              decodeResponseBody(Buffer.concat(chunks), typeof upstream.headers["content-encoding"] === "string" ? upstream.headers["content-encoding"] : undefined),
              upstream.headers["content-type"],
            );
            this.captureLocalValues(decoded);
            const headers = cleanResponseHeaders(upstream.headers);
            response.writeHead(upstream.statusCode ?? 502, headers);
            response.end(decoded);
          } catch {
            writeJson(response, { error: "upstream response decompression failed" }, 502);
          }
          resolve();
        });
        upstream.once("error", () => finish(502, "upstream request failed"));
        upstream.once("aborted", () => finish(502, "upstream request failed"));
      }));
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
      if (outgoingBody.length > 0) outbound.write(outgoingBody);
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
      if (!cacheKey.toLowerCase().endsWith(".d") || cacheConfig.decryptEnabled) data = rewriteLegacyNavigationScript(cacheKey, data);
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
      const outbound = this.trackOutbound(client.request({ hostname: target.hostname, port: target.port, path: resourcePath, method: "GET", rejectUnauthorized: false }, (upstream) => {
        const chunks: Buffer[] = [];
        upstream.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstream.once("end", () => {
          if (upstream.statusCode !== 200) {
            reject(new Error(`resource download failed with status ${upstream.statusCode ?? "unknown"}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
        upstream.once("error", reject);
        upstream.once("aborted", () => reject(new Error("resource download aborted")));
      }));
      outbound.once("error", reject);
      outbound.setTimeout(this.options.timeoutMs, () => {
        outbound.destroy();
        reject(new Error("resource download timeout"));
      });
      outbound.end();
    });
  }

  private trackOutbound(request: http.ClientRequest): http.ClientRequest {
    this.outboundRequests.add(request);
    request.once("close", () => this.outboundRequests.delete(request));
    return request;
  }
}

function contentTypeFor(relativePath: string): string {
  const withoutEncodingSuffix = relativePath.toLowerCase().replace(/\.d$/, "");
  const extension = withoutEncodingSuffix.slice(withoutEncodingSuffix.lastIndexOf("."));
  return ({ ".js": "application/javascript", ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml" } as Record<string, string>)[extension] ?? "application/octet-stream";
}
