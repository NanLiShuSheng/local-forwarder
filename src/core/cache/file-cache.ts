import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TztCodec } from "../tcp/tzt-codec";

export interface FileCacheOptions {
  rootDir: string;
}

export interface CacheResult {
  source: "cache" | "download";
  data: Buffer;
}

type Downloader = () => Promise<Uint8Array | Buffer>;

export class FileCache {
  private readonly rootDir: string;
  private readonly locks = new Map<string, Promise<CacheResult>>();

  public constructor(options: FileCacheOptions) {
    if (typeof options.rootDir !== "string" || options.rootDir.length === 0) throw new Error("cache rootDir is required");
    this.rootDir = path.resolve(options.rootDir);
  }

  public resolve(relativePath: string): string {
    if (typeof relativePath !== "string" || relativePath.length === 0) throw new Error("cache path is required");
    const candidate = path.resolve(this.rootDir, relativePath);
    if (candidate !== this.rootDir && !candidate.startsWith(`${this.rootDir}${path.sep}`)) throw new Error("path is outside cache root");
    return candidate;
  }

  public async get(relativePath: string): Promise<Buffer | undefined> {
    const filename = this.resolve(relativePath);
    try {
      const details = await stat(filename);
      if (!details.isFile()) return undefined;
      return await readFile(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  public async write(relativePath: string, data: Uint8Array): Promise<void> {
    const filename = this.resolve(relativePath);
    await mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    try {
      await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      await rename(temporary, filename);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  public async getOrDownload(relativePath: string, downloader: Downloader): Promise<CacheResult> {
    const normalized = this.resolve(relativePath);
    const existing = await this.get(relativePath);
    if (existing !== undefined) return { source: "cache", data: existing };
    const inFlight = this.locks.get(normalized);
    if (inFlight !== undefined) return inFlight;
    const operation = (async (): Promise<CacheResult> => {
      const afterWait = await this.get(relativePath);
      if (afterWait !== undefined) return { source: "cache", data: afterWait };
      const downloaded = Buffer.from(await downloader());
      await this.write(relativePath, downloaded);
      return { source: "download", data: downloaded };
    })();
    this.locks.set(normalized, operation);
    try {
      return await operation;
    } finally {
      if (this.locks.get(normalized) === operation) this.locks.delete(normalized);
    }
  }

  public async remove(relativePath: string): Promise<void> {
    await rm(this.resolve(relativePath), { force: true });
  }

  public async clear(): Promise<void> {
    await rm(this.rootDir, { recursive: true, force: true });
    await mkdir(this.rootDir, { recursive: true });
  }

  public async close(): Promise<void> {
    await Promise.allSettled(this.locks.values());
    this.locks.clear();
  }
}

export function decodeCachedResource(
  relativePath: string,
  data: Uint8Array,
  codec: Pick<TztCodec, "rc4">,
  decryptEnabled: boolean,
): Buffer {
  const input = Buffer.from(data);
  if (!decryptEnabled || !relativePath.toLowerCase().endsWith(".d")) return input;
  const originalName = relativePath.slice(0, -2);
  const extension = path.extname(originalName).toLowerCase();
  if (![".js", ".html", ".htm", ".css"].includes(extension)) return input;
  if (input.length < 4) throw new Error(`Invalid encrypted resource: ${relativePath}`);
  const decrypted = codec.rc4(input.subarray(0, -4), "file");
  if (path.basename(originalName).toLowerCase() === "tzt.js") {
    try {
      return gunzipSync(decrypted);
    } catch (error) {
      throw new Error(`Invalid gzip resource: ${relativePath}`, { cause: error });
    }
  }
  return decrypted;
}
