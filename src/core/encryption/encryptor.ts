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
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { EncryptionProgress } from "../../shared/contracts";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const excludedDirectoryNames = new Set(["node_modules"]);

export interface EncryptionFileResult {
  relativePath: string;
  outputPath: string;
}

export interface EncryptionResult {
  mode: EncryptionMode;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  removedFiles: number;
  files: EncryptionFileResult[];
  logs: string[];
}

export type EncryptionMode = "full" | "incremental";

export interface EncryptDirectoryOptions {
  inputDir: string;
  outputDir: string;
  encoderPath: string;
  encoderArgs?: string[];
  mode?: EncryptionMode;
  statePath?: string;
  tempRoot?: string;
  onProgress?: (progress: EncryptionProgress) => void;
}

interface EncryptionState {
  version: 1;
  inputDir: string;
  outputDir: string;
  encoderHash: string;
  files: Record<string, string>;
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
  encoderArgs = [],
  sourcePath,
  outputPath,
  tempRoot = os.tmpdir(),
}: {
  encoderPath: string;
  encoderArgs?: string[];
  sourcePath: string;
  outputPath: string;
  tempRoot?: string;
}): Promise<void> {
  const tempDir = await mkdtemp(path.join(tempRoot, "encode-work-"));
  const tempInputPath = path.join(tempDir, path.basename(sourcePath));
  const tempOutputPath = `${tempInputPath}.d`;
  try {
    await copyFile(sourcePath, tempInputPath);
    await execFileAsync(encoderPath, [...encoderArgs, tempInputPath], { windowsHide: true });
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

async function hashEncoder(encoderPath: string, encoderArgs: string[]): Promise<string> {
  const content = await readFile(encoderPath);
  return createHash("sha256").update(content).update("\0").update(JSON.stringify(encoderArgs)).digest("hex");
}

async function readEncryptState(statePath: string): Promise<EncryptionState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<EncryptionState>;
    if (parsed.version !== 1 || typeof parsed.inputDir !== "string" || typeof parsed.outputDir !== "string" || typeof parsed.encoderHash !== "string" || parsed.files === undefined || typeof parsed.files !== "object" || parsed.files === null) return undefined;
    return { version: 1, inputDir: parsed.inputDir, outputDir: parsed.outputDir, encoderHash: parsed.encoderHash, files: parsed.files as Record<string, string> };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeEncryptState(statePath: string, state: EncryptionState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temporary, statePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function outputExists(outputPath: string): Promise<boolean> {
  try {
    return (await stat(outputPath)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function safeOutputPath(outputDir: string, relativePath: string): string {
  const outputPath = path.resolve(outputDir, `${relativePath}.d`);
  if (!isSameOrInside(outputDir, outputPath)) throw new Error(`Output path is outside output directory: ${relativePath}`);
  return outputPath;
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
  encoderArgs = [],
  mode = "full",
  statePath = getDefaultEncryptStatePath(outputDir),
  tempRoot = os.tmpdir(),
  onProgress,
}: EncryptDirectoryOptions): Promise<EncryptionResult> {
  if (!inputDir || !outputDir) throw new Error("inputDir and outputDir are required");
  if (!encoderPath) throw new Error("encoderPath is required");
  if (mode !== "full" && mode !== "incremental") throw new Error(`Unsupported encryption mode: ${mode}`);

  await assertInputAndOutputAreSafe(inputDir, outputDir);
  try {
    await access(encoderPath, constants.X_OK);
  } catch {
    throw new Error(`Encoder does not exist or is not executable: ${encoderPath}`);
  }
  await mkdir(outputDir, { recursive: true });

  onProgress?.({ mode, phase: "scanning", current: 0, total: 0, processedFiles: 0, skippedFiles: 0, removedFiles: 0 });
  const files = await collectFiles(inputDir);
  const resolvedInputDir = await resolveForSafety(inputDir);
  const resolvedOutputDir = await resolveForSafety(outputDir);
  const encoderHash = await hashEncoder(encoderPath, encoderArgs);
  const previousState = await readEncryptState(statePath);
  const stateMatches = previousState?.inputDir === resolvedInputDir && previousState.outputDir === resolvedOutputDir && previousState.encoderHash === encoderHash;
  const previousFiles = stateMatches ? previousState.files : {};
  const currentRelativePaths = new Set(files.map((filePath) => path.relative(inputDir, filePath)));
  const nextState: EncryptionState = { version: 1, inputDir: resolvedInputDir, outputDir: resolvedOutputDir, encoderHash, files: {} };
  const resultFiles: EncryptionFileResult[] = [];
  const logs: string[] = [];
  let processedFiles = 0;
  let skippedFiles = 0;
  let removedFiles = 0;

  onProgress?.({ mode, phase: "processing", current: 0, total: files.length, processedFiles, skippedFiles, removedFiles });

  if (stateMatches) {
    for (const relativePath of Object.keys(previousFiles)) {
      if (currentRelativePaths.has(relativePath)) continue;
      const staleOutputPath = safeOutputPath(resolvedOutputDir, relativePath);
      if (await outputExists(staleOutputPath)) {
        await rm(staleOutputPath, { force: true });
        removedFiles += 1;
        onProgress?.({ mode, phase: "processing", status: "removing", current: 0, total: files.length, processedFiles, skippedFiles, removedFiles, relativePath });
      }
    }
  }

  for (const filePath of files) {
    const relativePath = path.relative(inputDir, filePath);
    const outputPath = safeOutputPath(resolvedOutputDir, relativePath);
    const sourceHash = await hashFile(filePath);
    nextState.files[relativePath] = sourceHash;
    const canSkip = mode === "incremental" && stateMatches && previousFiles[relativePath] === sourceHash && await outputExists(outputPath);
    if (canSkip) {
      skippedFiles += 1;
      onProgress?.({ mode, phase: "processing", status: "skipping", current: processedFiles + skippedFiles, total: files.length, processedFiles, skippedFiles, removedFiles, relativePath });
    } else {
      logs.push(`Encrypting ${relativePath}`);
      await runEncoder({ encoderPath, encoderArgs, sourcePath: filePath, outputPath, tempRoot });
      processedFiles += 1;
      onProgress?.({ mode, phase: "processing", status: "encrypting", current: processedFiles + skippedFiles, total: files.length, processedFiles, skippedFiles, removedFiles, relativePath });
    }
    resultFiles.push({ relativePath, outputPath });
  }

  await writeEncryptState(statePath, nextState);
  onProgress?.({ mode, phase: "completed", status: "completed", current: files.length, total: files.length, processedFiles, skippedFiles, removedFiles });
  return { mode, totalFiles: resultFiles.length, processedFiles, skippedFiles, removedFiles, files: resultFiles, logs };
}
