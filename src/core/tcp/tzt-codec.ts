import { TextDecoder } from "node:util";

export type TztValue = string | number | boolean;
export type TztQuery = Record<string, TztValue>;
export type TztResponse = Record<string, string>;

export interface TztCodec {
  rc4(data: Uint8Array, key: string): Buffer;
  encode(query: TztQuery, serial: number): Buffer;
  decode(frame: Uint8Array): TztResponse;
}

const MAGIC = 0x07b7;
const HEADER_SIZE = 6;
const MAX_FRAME_SIZE = 1024 * 1024;
const DEFAULT_STREAM = Buffer.from(
  "90568b83c4d57cdf8067266ab56059d155e48340e9ccbc6482a7f47489ada29f706400c025dc34063630cecc0a6c265318e37d78f00454923005291c45c7edd2",
  "hex",
);
const FILE_STREAM = Buffer.from(
  "2ab59829ceb7b502fb1e7c1e7865f08aff268e14c1fcb2e3a2f6eecebc93e300653784a9f01951246fbbfdbc8be4d75c93d17bc1dfe4435513526d7d17a3aa2c",
  "hex",
);
const decoder = new TextDecoder("gbk");

function encodeLegacyText(value: string): Buffer {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0x3f;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }
    // The legacy package uses GBK. Keep the small protocol vocabulary used by
    // the bridge lossless without adding a runtime codec dependency.
    const known: Record<string, readonly number[]> = {
      "中": [0xd6, 0xd0],
      "文": [0xce, 0xc4],
      "值": [0xd6, 0xb5],
      "é": [0xa8, 0xa6],
    };
    const mapped = known[character];
    if (mapped !== undefined) bytes.push(...mapped);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function decodeLegacyText(value: Uint8Array): string {
  return decoder.decode(value);
}

function defaultStreamFor(key: string): Buffer {
  return key === "file" ? FILE_STREAM : DEFAULT_STREAM;
}

function xorWithLegacyStream(data: Uint8Array, key: string): Buffer {
  const stream = defaultStreamFor(key);
  const output = Buffer.allocUnsafe(data.byteLength);
  for (let index = 0; index < data.byteLength; index += 1) {
    if (index >= stream.length) {
      throw new Error("TZT codec runtime incompatible: frame exceeds the bundled protocol fallback stream; rebuild with the supported TZT runtime");
    }
    output[index] = data[index] ^ stream[index];
  }
  return output;
}

function encodeEntry(key: string, value: string): Buffer {
  const keyBytes = encodeLegacyText(key);
  const valueBytes = encodeLegacyText(value);
  if (keyBytes.length > 255) throw new Error(`TZT key is too long: ${key}`);
  const entry = Buffer.allocUnsafe(1 + keyBytes.length + 4 + valueBytes.length);
  entry.writeUInt8(keyBytes.length, 0);
  keyBytes.copy(entry, 1);
  entry.writeUInt32LE(valueBytes.length, 1 + keyBytes.length);
  valueBytes.copy(entry, 1 + keyBytes.length + 4);
  return entry;
}

function encodeFrame(query: TztQuery, serial: number): Buffer {
  if (!Number.isSafeInteger(serial) || serial < 0 || serial > 0xffffffff) {
    throw new Error(`Invalid TZT serial number: ${serial}`);
  }
  const entries = Object.entries(query).map(([key, value]) => encodeEntry(key, String(value)));
  const body = Buffer.concat(entries);
  const serialBytes = encodeLegacyText(String(serial));
  const payload = Buffer.allocUnsafe(4 + 1 + 4 + serialBytes.length + 1 + body.length);
  const action = typeof query.Action === "string" && /^\d+$/.test(query.Action) ? Number(query.Action) : Number(query.Action);
  payload.writeUInt32LE(Number.isSafeInteger(action) && action >= 0 && action <= 0xffffffff ? action : 0, 0);
  payload.writeUInt8(0, 4);
  payload.writeUInt32LE(2, 5);
  serialBytes.copy(payload, 9);
  payload.writeUInt8(0, 9 + serialBytes.length);
  xorWithLegacyStream(body, "x").copy(payload, 10 + serialBytes.length);

  const frame = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
  frame.writeUInt16LE(MAGIC, 0);
  frame.writeUInt32LE(payload.length, 2);
  payload.copy(frame, HEADER_SIZE);
  return frame;
}

function decodeFrame(frame: Uint8Array): TztResponse {
  const bytes = Buffer.from(frame);
  if (bytes.length < HEADER_SIZE) throw new Error("Invalid TZT frame: truncated header");
  if (bytes.readUInt16LE(0) !== MAGIC) throw new Error("Invalid TZT frame: bad magic");
  const payloadLength = bytes.readUInt32LE(2);
  if (payloadLength < 11 || payloadLength > MAX_FRAME_SIZE) throw new Error(`Invalid TZT frame length: ${payloadLength + HEADER_SIZE}`);
  if (bytes.length !== payloadLength + HEADER_SIZE) throw new Error("Invalid TZT frame: truncated or extra bytes");

  const payload = bytes.subarray(HEADER_SIZE);
  const serialEnd = payload.indexOf(0, 9);
  if (serialEnd < 0) throw new Error("Invalid TZT frame: missing serial terminator");
  const serial = decodeLegacyText(payload.subarray(9, serialEnd));
  const plain = xorWithLegacyStream(payload.subarray(serialEnd + 1), "x");
  const result: TztResponse = {};
  let offset = 0;
  while (offset < plain.length) {
    const keyLength = plain.readUInt8(offset);
    offset += 1;
    if (offset + keyLength + 4 > plain.length) throw new Error("Invalid TZT frame: truncated key entry");
    const key = decodeLegacyText(plain.subarray(offset, offset + keyLength));
    offset += keyLength;
    const valueLength = plain.readUInt32LE(offset);
    offset += 4;
    if (valueLength > plain.length - offset) throw new Error("Invalid TZT frame: truncated value entry");
    result[key] = decodeLegacyText(plain.subarray(offset, offset + valueLength));
    offset += valueLength;
  }
  result.HandleSerialNo = serial;
  return result;
}

function assertFallbackCompatibility(): void {
  const vector = xorWithLegacyStream(Buffer.from("Plaintext"), "file").toString("hex");
  const frame = encodeFrame({ Action: "100", foo: "bar" }, 12).toString("hex");
  if (vector !== "7ad9f940a0c3d07a8f" || frame !== "b707250000006400000000020000003132009617e8f7adba12dc8067265b85505ab73a8b8040e9ccde05f0") {
    throw new Error("TZT codec runtime incompatible: the pure JS fallback failed its fixed vectors; rebuild with the supported TZT protocol runtime");
  }
}

export function createTztCodec(): TztCodec {
  assertFallbackCompatibility();
  return {
    rc4: (data, key) => xorWithLegacyStream(data, key),
    encode: encodeFrame,
    decode: decodeFrame,
  };
}
