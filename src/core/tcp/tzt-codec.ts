import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
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
const MAX_FRAME_SIZE = 1024 * 1024;
const FIXED_FRAME = "b707250000006400000000020000003132009617e8f7adba12dc8067265b85505ab73a8b8040e9ccde05f0";
const FIXED_FILE_RC4 = "7ad9f940a0c3d07a8f";
const FIXED_X_RC4 = "c03aeaeaaaa119a7f4";

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
  const bundled = platform === "win32" && arch === "x64"
    ? [path.join(protocolDir, "node", "win-x64", "node.exe")]
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

function createLegacyRuntime(): LegacyRuntime {
  const helper = path.join(protocolDirectory(), "tzt-node16-helper.js");
  const node = node16Binary();
  return {
    invoke(request) {
      let output: string;
      try {
        output = execFileSync(node, [helper], {
          input: JSON.stringify(request),
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
        });
      } catch (error) {
        throw new Error("TZT codec runtime incompatible: legacy protocol helper failed to execute", { cause: error });
      }
      try {
        return JSON.parse(output) as LegacyResponse;
      } catch (error) {
        throw new Error("TZT codec runtime incompatible: legacy protocol helper returned invalid JSON", { cause: error });
      }
    },
  };
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
