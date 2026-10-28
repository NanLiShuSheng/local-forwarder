import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync, readSync, writeSync } from "node:fs";
import { type Socket } from "node:net";
import os from "node:os";
import path from "node:path";

export type TztValue = string | number | boolean;
export type TztQuery = Record<string, TztValue>;
export type TztResponse = Record<string, unknown>;

export interface TztCodec {
  rc4(data: Uint8Array, key: string): Buffer;
  encode(query: TztQuery, serial: number): Buffer;
  decode(frame: Uint8Array): TztResponse;
}

interface LegacyRequest {
  method: "rc4" | "jsonltzt" | "tztljson";
  data?: string;
  key?: string;
  query?: TztQuery;
  handleSerialNo?: number;
  host?: string;
}

interface LegacyResponse {
  data: string | unknown[];
}

const MAGIC = 0x07b7;
const HEADER_SIZE = 6;
const MAX_FRAME_SIZE = 64 * 1024 * 1024;
// 新版 bytecode 的 zzkeyByte 元数据会把大字段响应 JSON 放大约 14 倍（1.5MB 字段实测 21MB），上限与帧上限对齐
const MAX_HELPER_RESPONSE_SIZE = 64 * 1024 * 1024;
const EAGAIN_WAIT_FLAG = new Int32Array(new SharedArrayBuffer(4));
const FIXED_FRAME = "b7072500000064000300000200000031320006416374696f6e0300000031303003666f6f03000000626172";
const FIXED_FILE_RC4 = "7ad9f940a0c3d07a8f";
const FIXED_X_RC4 = "32da9e2ceaea1a6e75";

type LegacyRuntime = {
  invoke(request: LegacyRequest): LegacyResponse;
  checked?: boolean;
};

let cachedRuntime: LegacyRuntime | undefined;

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
  const bundled = [path.join(protocolDir, "node", `${platform === "win32" ? "win" : platform}-${arch}`, platform === "win32" ? "node.exe" : "node")];
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

function createLegacyRuntime(): LegacyRuntime {
  const helper = path.join(protocolDirectory(), "tzt-node16-helper.js");
  const node = node16Binary();
  let current: { child: ChildProcess; input: number; output: number; dead: boolean } | undefined;
  let stderrTail = "";

  const spawnHelper = () => {
    const child = spawn(node, [helper, "--serve"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const proc = { child, input: helperFd(child.stdin), output: helperFd(child.stdout), dead: false };
    child.unref();
    (child.stdin as Socket).unref();
    (child.stdout as Socket).unref();
    (child.stderr as Socket).unref();
    (child.stderr as Socket).on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString("utf8")).slice(-4096);
    });
    const killOnExit = () => {
      child.kill();
    };
    child.on("error", () => {
      proc.dead = true;
    });
    child.on("exit", () => {
      proc.dead = true;
      process.removeListener("exit", killOnExit);
    });
    process.once("exit", killOnExit);
    return proc;
  };

  return {
    invoke(request) {
      if (current === undefined || current.dead) current = spawnHelper();
      const proc = current;
      let parsed: LegacyResponse & { error?: string };
      try {
        const payload = Buffer.from(JSON.stringify(request), "utf8");
        const header = Buffer.alloc(4);
        header.writeUInt32LE(payload.length, 0);
        writeAll(proc.input, header);
        writeAll(proc.input, payload);
        const responseLength = readExact(proc.output, 4).readUInt32LE(0);
        if (responseLength > MAX_HELPER_RESPONSE_SIZE) throw new Error(`legacy protocol helper response is too large: ${responseLength} bytes`);
        parsed = JSON.parse(readExact(proc.output, responseLength).toString("utf8")) as LegacyResponse & { error?: string };
      } catch (error) {
        proc.dead = true;
        const detail = stderrTail.trim();
        throw new Error(`TZT codec runtime incompatible: legacy protocol helper failed${detail === "" ? "" : `: ${detail.slice(-500)}`}`, { cause: error });
      }
      if (typeof parsed.error === "string") throw new Error(`TZT codec runtime incompatible: legacy protocol helper reported an error: ${parsed.error}`);
      return parsed;
    },
  };
}

function helperFd(stream: unknown): number {
  const fd = (stream as { _handle?: { fd?: unknown } } | null)?._handle?.fd;
  if (typeof fd !== "number") throw new Error("TZT codec runtime incompatible: stdio pipe file descriptor is unavailable");
  return fd;
}

// Node marks child stdio pipes non-blocking, so synchronous pipe I/O must retry on EAGAIN.
function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) {
    try {
      offset += writeSync(fd, buffer, offset, buffer.length - offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(EAGAIN_WAIT_FLAG, 0, 0, 1);
    }
  }
}

function readExact(fd: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    try {
      const read = readSync(fd, buffer, offset, length - offset, null);
      if (read === 0) throw new Error("legacy protocol helper closed its output stream");
      offset += read;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error;
      Atomics.wait(EAGAIN_WAIT_FLAG, 0, 0, 1);
    }
  }
  return buffer;
}

function legacyRuntime(): LegacyRuntime {
  if (cachedRuntime === undefined) cachedRuntime = createLegacyRuntime();
  return cachedRuntime;
}

function decodeBase64Response(response: LegacyResponse): Buffer {
  if (typeof response.data !== "string") throw new Error("TZT codec runtime incompatible: expected a base64 response");
  return Buffer.from(response.data, "base64");
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

function assertRuntimeCompatibility(runtime: LegacyRuntime): void {
  const fileResult = decodeBase64Response(runtime.invoke({ method: "rc4", data: Buffer.from("Plaintext").toString("base64"), key: "file" }));
  const xResult = decodeBase64Response(runtime.invoke({ method: "rc4", data: Buffer.from("Plaintext").toString("base64"), key: "x" }));
  const frame = decodeBase64Response(runtime.invoke({ method: "jsonltzt", query: { Action: "100", foo: "bar" }, handleSerialNo: 12 }));
  if (fileResult.toString("hex") !== FIXED_FILE_RC4 || xResult.toString("hex") !== FIXED_X_RC4 || frame.toString("hex") !== FIXED_FRAME) {
    throw new Error("TZT codec runtime incompatible: bundled legacy protocol failed its fixed regression vectors");
  }
}

function decodeLegacyResponse(value: unknown): TztResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid TZT response: expected an object");
  const result = { ...(value as Record<string, unknown>) };
  if (result.HandleSerialNo === undefined) throw new Error("Invalid TZT response: missing serial number");
  if (typeof result.HandleSerialNo !== "string" && typeof result.HandleSerialNo !== "number") throw new Error("Invalid TZT response: invalid serial number");
  return result;
}

export function createTztCodec(): TztCodec {
  const runtime = legacyRuntime();
  if (!runtime.checked) {
    assertRuntimeCompatibility(runtime);
    runtime.checked = true;
  }

  return {
    rc4(data, key) {
      return decodeBase64Response(runtime.invoke({ method: "rc4", data: Buffer.from(data).toString("base64"), key }));
    },
    encode(query, serial) {
      if (!Number.isSafeInteger(serial) || serial < 0 || serial > 0xffffffff) throw new Error(`Invalid TZT serial number: ${serial}`);
      return decodeBase64Response(runtime.invoke({ method: "jsonltzt", query, handleSerialNo: serial }));
    },
    decode(frame) {
      const bytes = assertFrameShape(frame);
      const response = runtime.invoke({ method: "tztljson", data: bytes.toString("base64"), host: "local-forwarder" });
      if (!Array.isArray(response.data) || response.data.length !== 1) throw new Error("Invalid TZT frame: legacy decoder returned no single response");
      return decodeLegacyResponse(response.data[0]);
    },
  };
}
