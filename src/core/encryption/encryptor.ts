import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const excludedDirectoryNames = new Set(["node_modules", "dist"]);

export interface EncryptionFileResult {
  relativePath: string;
  outputPath: string;
}

export interface EncryptionResult {
  totalFiles: number;
  files: EncryptionFileResult[];
  logs: string[];
}

export interface EncryptDirectoryOptions {
  inputDir: string;
  outputDir: string;
  encoderPath: string;
  statePath?: string;
  tempRoot?: string;
}

export function getDefaultEncryptStatePath(outputDir: string): string {
  return path.join(outputDir, ".encrypt-cache.json");
}

function shouldIgnoreEntry(entry: { name: string; isDirectory(): boolean; isFile(): boolean }): boolean {
  if (entry.name.startsWith(".")) return true;
  if (entry.isDirectory() && excludedDirectoryNames.has(entry.name)) return true;
  if (entry.isFile() && entry.name.endsWith(".map")) return true;
  return false;
}

export async function collectFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (shouldIgnoreEntry(entry)) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = error as Error & { stdout?: string; stderr?: string };
  return [detail.message, detail.stdout, detail.stderr].filter(Boolean).join("\n");
}

export async function runEncoder({
  encoderPath,
  sourcePath,
  outputPath,
  tempRoot = os.tmpdir(),
}: {
  encoderPath: string;
  sourcePath: string;
  outputPath: string;
  tempRoot?: string;
}): Promise<void> {
  const tempDir = await mkdtemp(path.join(tempRoot, "encode-work-"));
  const tempInputPath = path.join(tempDir, path.basename(sourcePath));
  const tempOutputPath = `${tempInputPath}.d`;
  try {
    await copyFile(sourcePath, tempInputPath);
    await execFileAsync(encoderPath, [tempInputPath]);
    try {
      await access(tempOutputPath);
    } catch {
      throw new Error("encoded output was not produced");
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await copyFile(tempOutputPath, outputPath);
  } catch (error) {
    throw new Error(`Failed to encrypt "${sourcePath}": ${errorDetails(error)}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function readEncryptState(statePath: string): Promise<{ files: Record<string, string> }> {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as { files: Record<string, string> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { files: {} };
    throw error;
  }
}

async function writeEncryptState(statePath: string, state: { files: Record<string, string> }): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
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
  if (!inputStats?.isDirectory()) throw new Error(`Input directory does not exist: ${inputDir}`);
  const inputPath = await resolveForSafety(inputDir);
  const outputPath = await resolveForSafety(outputDir);
  if (isSameOrInside(inputPath, outputPath)) {
    throw new Error("Output directory must be outside the input directory");
  }
}

export async function encryptDirectory({
  inputDir,
  outputDir,
  encoderPath,
  statePath = getDefaultEncryptStatePath(outputDir),
  tempRoot = os.tmpdir(),
}: EncryptDirectoryOptions): Promise<EncryptionResult> {
  if (!inputDir || !outputDir) throw new Error("inputDir and outputDir are required");
  if (!encoderPath) throw new Error("encoderPath is required");

  await assertInputAndOutputAreSafe(inputDir, outputDir);
  try {
    await access(encoderPath, constants.X_OK);
  } catch {
    throw new Error(`Encoder does not exist or is not executable: ${encoderPath}`);
  }
  await mkdir(outputDir, { recursive: true });

  const files = await collectFiles(inputDir);
  await readEncryptState(statePath);
  const nextState = { files: {} as Record<string, string> };
  const resultFiles: EncryptionFileResult[] = [];
  const logs: string[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(inputDir, filePath);
    const outputPath = path.join(outputDir, `${relativePath}.d`);
    nextState.files[relativePath] = await hashFile(filePath);
    logs.push(`Encrypting ${relativePath}`);
    await runEncoder({ encoderPath, sourcePath: filePath, outputPath, tempRoot });
    resultFiles.push({ relativePath, outputPath });
  }

  await writeEncryptState(statePath, nextState);
  return { totalFiles: resultFiles.length, files: resultFiles, logs };
}
