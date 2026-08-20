import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EncryptionPreferences {
  inputDir: string;
  outputDir: string;
}

const emptyPreferences: EncryptionPreferences = { inputDir: "", outputDir: "" };

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
    return {
      inputDir: await normalizeExistingDirectory(parsed.inputDir),
      outputDir: await normalizeExistingDirectory(parsed.outputDir),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...emptyPreferences };
    throw error;
  }
}

export async function saveEncryptionPreferences(
  preferencesPath: string,
  patch: Partial<EncryptionPreferences>,
): Promise<EncryptionPreferences> {
  const current = await readEncryptionPreferences(preferencesPath);
  const next: EncryptionPreferences = {
    inputDir: typeof patch.inputDir === "string" ? patch.inputDir : current.inputDir,
    outputDir: typeof patch.outputDir === "string" ? patch.outputDir : current.outputDir,
  };
  await mkdir(path.dirname(preferencesPath), { recursive: true });
  await writeFile(preferencesPath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  return next;
}
