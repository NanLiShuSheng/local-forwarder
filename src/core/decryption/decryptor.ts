import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { crc32, gunzipSync } from "node:zlib";
import type {
  DecryptionFailure,
  DecryptionFileResult,
  DecryptionProgress,
  DecryptionResult,
} from "../../shared/contracts";
import { createTztCodec, type TztCodec } from "../tcp/tzt-codec";

const encryptedSuffix = ".d";
const encryptionStateFileName = ".encrypt-cache.json";
const scriptExtensions = new Set([".js", ".html", ".htm", ".css"]);
const batchFileLimit = 32;

interface DecryptionState {
  version: 1;
  files: Record<string, string>;
}

interface DecryptionJob {
  sourcePath: string;
  relativePath: string;
  outputPath: string;
  isScript: boolean;
  expectedHash?: string;
}

interface PreparedJob {
  job: DecryptionJob;
  body?: Buffer;
  error?: string;
}

export interface CollectedEncryptedFiles {
  files: string[];
  skippedFiles: number;
}

export interface DecryptDirectoryOptions {
  inputDir: string;
  outputDir: string;
  statePath?: string;
  codec?: Pick<TztCodec, "rc4Batch">;
  onProgress?: (progress: DecryptionProgress) => void;
}

export async function collectEncryptedFiles(rootDir: string): Promise<CollectedEncryptedFiles> {
  const files: string[] = [];
  let skippedFiles = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(encryptedSuffix) && entry.name !== encryptedSuffix) {
        files.push(fullPath);
      } else if (entry.name !== encryptionStateFileName) {
        skippedFiles += 1;
      }
    }
  }

  await walk(rootDir);
  return { files, skippedFiles };
}

async function resolveForSafety(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  try {
    return await realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) return resolved;
    return path.join(await resolveForSafety(parent), path.basename(resolved));
  }
}

function isSameOrInside(parentPath: string, childPath: string): boolean {
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

async function assertInputAndOutputAreSafe(inputDir: string, outputDir: string): Promise<void> {
  const inputStats = await stat(inputDir).catch(() => null);
  if (!inputStats?.isDirectory()) throw new Error(`待解密目录不存在：${inputDir}`);
  const inputPath = await resolveForSafety(inputDir);
  const outputPath = await resolveForSafety(outputDir);
  if (isSameOrInside(inputPath, outputPath)) {
    throw new Error("解密输出目录不能位于待解密目录内部");
  }
}

async function readExpectedHashes(statePath: string): Promise<Record<string, string> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<DecryptionState>;
    if (parsed.version !== 1 || typeof parsed.files !== "object" || parsed.files === null || Array.isArray(parsed.files)) return undefined;
    return Object.fromEntries(
      Object.entries(parsed.files).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[a-f0-9]{64}$/i.test(entry[1])),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

function createDecryptionJob(sourcePath: string, inputDir: string, outputDir: string, expectedHashes: Record<string, string>): DecryptionJob {
  const encryptedRelativePath = path.relative(inputDir, sourcePath);
  const relativePath = encryptedRelativePath.slice(0, -encryptedSuffix.length);
  if (relativePath.length === 0 || relativePath === "." || relativePath === ".." || path.isAbsolute(relativePath)) {
    throw new Error(`无效的加密文件名：${encryptedRelativePath}`);
  }
  const outputPath = path.resolve(outputDir, relativePath);
  if (!isSameOrInside(path.resolve(outputDir), outputPath) || outputPath === path.resolve(outputDir)) {
    throw new Error(`解密输出路径越界：${encryptedRelativePath}`);
  }
  return {
    sourcePath,
    relativePath,
    outputPath,
    isScript: scriptExtensions.has(path.extname(relativePath).toLowerCase()),
    expectedHash: expectedHashes[relativePath],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function verifyCrc(body: Buffer, expectedCrc: number): string | undefined {
  const actualCrc = crc32(body) >>> 0;
  if (actualCrc === expectedCrc) return undefined;
  return `CRC32 校验失败（应为 ${expectedCrc.toString(16).padStart(8, "0")}，实际为 ${actualCrc.toString(16).padStart(8, "0")}）`;
}

export async function decryptDirectory({
  inputDir,
  outputDir,
  statePath = path.join(inputDir, encryptionStateFileName),
  codec,
  onProgress,
}: DecryptDirectoryOptions): Promise<Omit<DecryptionResult, "ok">> {
  if (!inputDir || !outputDir) throw new Error("待解密目录和解密输出目录不能为空");
  await assertInputAndOutputAreSafe(inputDir, outputDir);
  await mkdir(outputDir, { recursive: true });

  onProgress?.({ phase: "scanning", current: 0, total: 0, processedFiles: 0, failedFiles: 0 });
  const collected = await collectEncryptedFiles(inputDir);
  if (collected.files.length === 0) throw new Error("待解密目录中未找到可解密的 .d 文件");

  const expectedHashes = await readExpectedHashes(statePath) ?? {};
  const jobs = collected.files.map((filePath) => createDecryptionJob(filePath, inputDir, outputDir, expectedHashes));

  let activeCodec = codec;
  const getCodec = (): Pick<TztCodec, "rc4Batch"> => {
    activeCodec ??= createTztCodec();
    return activeCodec;
  };

  const files: DecryptionFileResult[] = [];
  const failures: DecryptionFailure[] = [];
  const logs: string[] = [];
  let processedFiles = 0;
  let failedFiles = 0;
  let hashVerifiedFiles = 0;

  if (Object.keys(expectedHashes).length === 0) {
    logs.push("未找到有效的 .encrypt-cache.json 完整性清单，本次仅执行 CRC32 校验。");
  }
  onProgress?.({ phase: "processing", current: 0, total: jobs.length, processedFiles, failedFiles });

  const recordFailure = (job: DecryptionJob, error: string): void => {
    failedFiles += 1;
    failures.push({ relativePath: job.relativePath, error });
    logs.push(`失败：${job.relativePath} - ${error}`);
    onProgress?.({
      phase: "processing",
      status: "failed",
      current: processedFiles + failedFiles,
      total: jobs.length,
      processedFiles,
      failedFiles,
      relativePath: job.relativePath,
    });
  };

  for (let offset = 0; offset < jobs.length; offset += batchFileLimit) {
    const chunk = jobs.slice(offset, offset + batchFileLimit);
    const prepared: PreparedJob[] = [];
    for (const job of chunk) {
      try {
        const encrypted = await readFile(job.sourcePath);
        if (encrypted.length < 4) throw new Error("加密文件过短，缺少 CRC32 校验尾");
        const body = encrypted.subarray(0, -4);
        const crcError = verifyCrc(body, encrypted.readUInt32LE(encrypted.length - 4));
        if (crcError !== undefined) throw new Error(crcError);
        prepared.push({ job, body });
      } catch (error) {
        prepared.push({ job, error: errorMessage(error) });
      }
    }

    const scriptJobs = prepared.filter((entry): entry is PreparedJob & { body: Buffer } => entry.error === undefined && entry.job.isScript);
    let decryptedScripts: Buffer[] | undefined;
    let scriptError: string | undefined;
    if (scriptJobs.length > 0) {
      try {
        decryptedScripts = getCodec().rc4Batch(scriptJobs.map((entry) => entry.body), "file");
      } catch (error) {
        scriptError = `RC4 解密失败：${errorMessage(error)}`;
      }
    }
    let scriptIndex = 0;

    for (const entry of prepared) {
      const { job } = entry;
      if (entry.error !== undefined) {
        recordFailure(job, entry.error);
        continue;
      }
      if (entry.body === undefined) {
        recordFailure(job, "读取加密文件失败");
        continue;
      }
      let output: Buffer;
      try {
        if (job.isScript) {
          const decrypted = decryptedScripts?.[scriptIndex];
          scriptIndex += 1;
          if (decrypted === undefined) throw new Error(scriptError ?? "脚本解密失败");
          output = gunzipSync(decrypted);
        } else {
          output = entry.body;
        }
        if (job.expectedHash !== undefined) {
          const actualHash = createHash("sha256").update(output).digest("hex");
          if (actualHash !== job.expectedHash) throw new Error("SHA-256 完整性校验失败，解密结果与加密清单不一致");
        }
        await mkdir(path.dirname(job.outputPath), { recursive: true });
        const temporaryPath = path.join(
          path.dirname(job.outputPath),
          `.decrypt-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
        );
        try {
          await writeFile(temporaryPath, output, { flag: "wx" });
          await rename(temporaryPath, job.outputPath);
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => undefined);
        }
      } catch (error) {
        recordFailure(job, errorMessage(error));
        continue;
      }

      processedFiles += 1;
      if (job.expectedHash !== undefined) hashVerifiedFiles += 1;
      files.push({ relativePath: job.relativePath, outputPath: job.outputPath, hashVerified: job.expectedHash !== undefined });
      logs.push(`解密：${job.relativePath}`);
      onProgress?.({
        phase: "processing",
        status: "decrypting",
        current: processedFiles + failedFiles,
        total: jobs.length,
        processedFiles,
        failedFiles,
        relativePath: job.relativePath,
      });
    }
  }

  onProgress?.({
    phase: "completed",
    status: "completed",
    current: jobs.length,
    total: jobs.length,
    processedFiles,
    failedFiles,
  });
  return {
    totalFiles: jobs.length,
    processedFiles,
    failedFiles,
    skippedFiles: collected.skippedFiles,
    hashVerifiedFiles,
    files,
    failures,
    logs,
  };
}
