import type { BuildTask } from "./components/WorkspacePages";

export const BUILD_TASK_HISTORY_STORAGE_KEY = "local-forwarder.build-task-history";
export const BUILD_TASK_HISTORY_LIMIT = 20;
const INTERRUPTED_TASK_ERROR = "应用退出，任务已中断";

export interface BuildTaskHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function normalizeBuildTask(value: unknown): BuildTask | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== "string" || value.id.trim() === "") return undefined;
  if (value.kind !== "encrypt" && value.kind !== "decrypt") return undefined;
  if (value.status !== "running" && value.status !== "success" && value.status !== "error" && value.status !== "canceled") return undefined;
  if (typeof value.inputDir !== "string" || typeof value.outputDir !== "string") return undefined;
  if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return undefined;
  if (!isOptionalNumber(value.finishedAt) || !isOptionalNumber(value.totalFiles) || !isOptionalNumber(value.processedFiles) || !isOptionalNumber(value.failedFiles)) return undefined;
  if (value.mode !== undefined && value.mode !== "full" && value.mode !== "incremental" && value.mode !== "restore") return undefined;
  if (value.error !== undefined && typeof value.error !== "string") return undefined;

  const task: BuildTask = {
    id: value.id,
    kind: value.kind,
    status: value.status === "running" ? "canceled" : value.status,
    inputDir: value.inputDir,
    outputDir: value.outputDir,
    startedAt: value.startedAt,
  };
  if (value.mode !== undefined) task.mode = value.mode;
  if (value.finishedAt !== undefined) task.finishedAt = value.finishedAt;
  if (value.totalFiles !== undefined) task.totalFiles = value.totalFiles;
  if (value.processedFiles !== undefined) task.processedFiles = value.processedFiles;
  if (value.failedFiles !== undefined) task.failedFiles = value.failedFiles;
  if (value.status === "running") task.error = INTERRUPTED_TASK_ERROR;
  else if (value.error !== undefined) task.error = value.error;
  return task;
}

function latestBuildTasks(tasks: BuildTask[]): BuildTask[] {
  return [...tasks].sort((left, right) => right.startedAt - left.startedAt).slice(0, BUILD_TASK_HISTORY_LIMIT);
}

export function getBuildTaskHistoryStorage(): BuildTaskHistoryStorage | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const storage = window.localStorage;
    if (storage === undefined) return undefined;

    return {
      getItem: (key) => {
        try {
          return storage.getItem(key);
        } catch {
          return null;
        }
      },
      setItem: (key, value) => {
        try {
          storage.setItem(key, value);
        } catch {
          // Persistence is optional in restricted browser contexts.
        }
      },
    };
  } catch {
    return undefined;
  }
}

export function readBuildTaskHistory(storage: BuildTaskHistoryStorage | undefined): BuildTask[] {
  try {
    const raw = storage?.getItem(BUILD_TASK_HISTORY_STORAGE_KEY);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return latestBuildTasks(parsed.map(normalizeBuildTask).filter((task): task is BuildTask => task !== undefined));
  } catch {
    return [];
  }
}

export function writeBuildTaskHistory(storage: BuildTaskHistoryStorage | undefined, tasks: BuildTask[]): void {
  try {
    storage?.setItem(BUILD_TASK_HISTORY_STORAGE_KEY, JSON.stringify(latestBuildTasks(tasks)));
  } catch {
    // The current session still keeps the task list in memory.
  }
}
