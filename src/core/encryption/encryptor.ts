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
  lowercaseOutput?: boolean;
  statePath?: string;
  tempRoot?: string;
  onProgress?: (progress: EncryptionProgress) => void;
}

interface EncryptionState {
  version: 1;
  inputDir: string;
  outputDir: string;
  encoderHash: string;
  lowercaseOutput: boolean;
  files: Record<string, string>;
}

export interface EncryptionOutputPathPlan {
  relativePath: string;
  outputRelativePath: string;
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

export function planEncryptionOutputPaths(relativePaths: readonly string[], lowercaseOutput: boolean): EncryptionOutputPathPlan[] {
  const planned = relativePaths.map((relativePath) => ({
    relativePath,
    outputRelativePath: lowercaseOutput ? relativePath.toLowerCase() : relativePath,
  }));
  if (!lowercaseOutput) return planned;

  const seen = new Map<string, string>();
  for (const entry of planned) {
    const previous = seen.get(entry.outputRelativePath);
    if (previous !== undefined) {
      throw new Error(`小写文件输出路径冲突：“${previous}”与“${entry.relativePath}”都映射到“${entry.outputRelativePath}.d”`);
    }
    seen.set(entry.outputRelativePath, entry.relativePath);
  }
  return planned;
}

function errorDetails(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const detail = error as Error & { code?: string; errno?: number; stdout?: string; stderr?: string };
  const output = [detail.message, detail.stdout, detail.stderr].filter(Boolean).join("\n");
  const isAppleSiliconRosettaError = process.platform === "darwin"
    && process.arch === "arm64"
    && (detail.code === "EBADARCH" || detail.errno === -86 || /bad cpu type in executable/i.test(output));
  if (isAppleSiliconRosettaError) {
    return output + "\nApple 芯片 Mac 上运行加密器需要 Rosetta 2。请安装 Rosetta 2 后重试。";
  }
  return output;
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
    if (parsed.version !== 1 || typeof parsed.inputDir !== "string" || typeof parsed.outputDir !== "string" || typeof parsed.encoderHash !== "string" || (parsed.lowercaseOutput !== undefined && typeof parsed.lowercaseOutput !== "boolean") || parsed.files === undefined || typeof parsed.files !== "object" || parsed.files === null) return undefined;
    return { version: 1, inputDir: parsed.inputDir, outputDir: parsed.outputDir, encoderHash: parsed.encoderHash, lowercaseOutput: parsed.lowercaseOutput === true, files: parsed.files as Record<string, string> };
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

async function renameEntryToExpectedCase(parentDir: string, actualName: string, expectedName: string): Promise<void> {
  const sourcePath = path.join(parentDir, actualName);
  const temporaryPath = path.join(parentDir, `.lowercase-entry-${process.pid}-${Math.random().toString(16).slice(2)}`);
  await rename(sourcePath, temporaryPath);
  try {
    await rename(temporaryPath, path.join(parentDir, expectedName));
  } catch (error) {
    await rename(temporaryPath, sourcePath).catch(() => undefined);
    throw error;
  }
}

async function normalizeOutputDirectoryPath(outputDir: string, relativeDir: string): Promise<void> {
  let currentDir = outputDir;
  for (const segment of relativeDir.split(path.sep).filter(Boolean)) {
    const expectedName = segment.toLowerCase();
    const entries = await readdir(currentDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const matches = entries.filter((entry) => entry.name.toLowerCase() === expectedName);
    if (matches.length > 1) throw new Error(`小写文件输出目录存在大小写冲突：“${currentDir}”中的多个目录都映射到“${expectedName}”`);
    const match = matches[0];
    if (match === undefined) {
      currentDir = path.join(currentDir, expectedName);
      await mkdir(currentDir);
      continue;
    }
    if (!match.isDirectory()) throw new Error(`小写文件输出目录与同名文件冲突：“${path.join(currentDir, match.name)}”`);
    if (match.name !== expectedName) {
      await renameEntryToExpectedCase(currentDir, match.name, expectedName);
    }
    currentDir = path.join(currentDir, expectedName);
  }
}

async function normalizeOutputFilePath(outputDir: string, relativeFilePath: string): Promise<void> {
  const parentDir = path.join(outputDir, path.dirname(relativeFilePath));
  const expectedName = path.basename(relativeFilePath).toLowerCase();
  const entries = await readdir(parentDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const matches = entries.filter((entry) => entry.name.toLowerCase() === expectedName);
  if (matches.length > 1) throw new Error(`小写文件输出存在大小写冲突：“${parentDir}”中的多个文件都映射到“${expectedName}”`);
  const match = matches[0];
  if (match === undefined) return;
  if (!match.isFile()) throw new Error(`小写文件输出文件与同名目录冲突：“${path.join(parentDir, match.name)}”`);
  if (match.name !== expectedName) await renameEntryToExpectedCase(parentDir, match.name, expectedName);
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
  lowercaseOutput = false,
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
  const previousLowercaseOutput = previousState?.lowercaseOutput ?? false;
  const stateMatches = previousState?.inputDir === resolvedInputDir && previousState.outputDir === resolvedOutputDir && previousState.encoderHash === encoderHash && previousLowercaseOutput === lowercaseOutput;
  const previousFiles = stateMatches ? previousState.files : {};
  const outputPlans = planEncryptionOutputPaths(files.map((filePath) => path.relative(inputDir, filePath)), lowercaseOutput);
  const currentOutputPaths = new Map(outputPlans.map((plan) => [plan.relativePath, plan.outputRelativePath]));
  const nextState: EncryptionState = { version: 1, inputDir: resolvedInputDir, outputDir: resolvedOutputDir, encoderHash, lowercaseOutput, files: {} };
  const resultFiles: EncryptionFileResult[] = [];
  const logs: string[] = [];
  let processedFiles = 0;
  let skippedFiles = 0;
  let removedFiles = 0;

  onProgress?.({ mode, phase: "processing", current: 0, total: files.length, processedFiles, skippedFiles, removedFiles });

  if (previousState?.inputDir === resolvedInputDir && previousState.outputDir === resolvedOutputDir) {
    for (const relativePath of Object.keys(previousState.files)) {
      const previousOutputRelativePath = previousLowercaseOutput ? relativePath.toLowerCase() : relativePath;
      if (currentOutputPaths.get(relativePath) === previousOutputRelativePath) continue;
      const staleOutputPath = safeOutputPath(resolvedOutputDir, previousOutputRelativePath);
      if (await outputExists(staleOutputPath)) {
        await rm(staleOutputPath, { force: true });
        removedFiles += 1;
        onProgress?.({ mode, phase: "processing", status: "removing", current: 0, total: files.length, processedFiles, skippedFiles, removedFiles, relativePath });
      }
    }
  }

  if (lowercaseOutput) {
    const outputDirectories = [...new Set(outputPlans.map((plan) => path.dirname(plan.outputRelativePath)).filter((relativeDir) => relativeDir !== "."))];
    for (const relativeDir of outputDirectories) await normalizeOutputDirectoryPath(resolvedOutputDir, relativeDir);
  }

  for (const [index, outputPlan] of outputPlans.entries()) {
    const filePath = files[index]!;
    const { relativePath, outputRelativePath } = outputPlan;
    const outputPath = safeOutputPath(resolvedOutputDir, outputRelativePath);
    if (lowercaseOutput) await normalizeOutputFilePath(resolvedOutputDir, `${outputRelativePath}.d`);
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
