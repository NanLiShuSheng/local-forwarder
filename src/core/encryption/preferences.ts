import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EncryptionPreferences {
  inputDir: string;
  outputDir: string;
  inputHistory: string[];
  outputHistory: string[];
}

const HISTORY_LIMIT = 10;
const emptyPreferences: EncryptionPreferences = { inputDir: "", outputDir: "", inputHistory: [], outputHistory: [] };

type EncryptionPreferencesPatch = Partial<Pick<EncryptionPreferences, "inputDir" | "outputDir">>;

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))].slice(0, HISTORY_LIMIT);
}

function addToHistory(history: string[], value: string): string[] {
  if (value.length === 0) return history;
  return [value, ...history.filter((entry) => entry !== value)].slice(0, HISTORY_LIMIT);
}

async function normalizeExistingDirectory(value: unknown): Promise<string> {
  if (typeof value !== "string" || value.length === 0) return "";
  try {
    return (await stat(value)).isDirectory() ? value : "";
  } catch {
    return "";
  }
}

export async function readEncryptionPreferences(preferencesPath: string): Promise<EncryptionPreferences> {
  try {
    const parsed = JSON.parse(await readFile(preferencesPath, "utf8")) as Record<string, unknown>;
    const inputDir = await normalizeExistingDirectory(parsed.inputDir);
    const outputDir = await normalizeExistingDirectory(parsed.outputDir);
    return {
      inputDir,
      outputDir,
      inputHistory: addToHistory(normalizeHistory(parsed.inputHistory), inputDir),
      outputHistory: addToHistory(normalizeHistory(parsed.outputHistory), outputDir),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...emptyPreferences };
    throw error;
  }
}

export async function saveEncryptionPreferences(
  preferencesPath: string,
  patch: EncryptionPreferencesPatch,
): Promise<EncryptionPreferences> {
  const current = await readEncryptionPreferences(preferencesPath);
  const next: EncryptionPreferences = {
    inputDir: typeof patch.inputDir === "string" ? patch.inputDir : current.inputDir,
    outputDir: typeof patch.outputDir === "string" ? patch.outputDir : current.outputDir,
    inputHistory: typeof patch.inputDir === "string" ? addToHistory(current.inputHistory, patch.inputDir) : current.inputHistory,
    outputHistory: typeof patch.outputDir === "string" ? addToHistory(current.outputHistory, patch.outputDir) : current.outputHistory,
  };
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(preferencesPath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return next;
}
