import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { BuildTask } from "../../src/renderer/components/WorkspacePages";
import {
  BUILD_TASK_HISTORY_LIMIT,
  BUILD_TASK_HISTORY_STORAGE_KEY,
  readBuildTaskHistory,
  writeBuildTaskHistory,
  type BuildTaskHistoryStorage,
} from "../../src/renderer/build-task-history";

function buildTask(index: number, patch: Partial<BuildTask> = {}): BuildTask {
  return {
    id: `build-${index}`,
    kind: index % 2 === 0 ? "encrypt" : "decrypt",
    mode: index % 2 === 0 ? "incremental" : "restore",
    status: "success",
    inputDir: `/input/${index}`,
    outputDir: `/output/${index}`,
    startedAt: 1_000 + index,
    finishedAt: 1_100 + index,
    totalFiles: 4,
    processedFiles: 4,
    failedFiles: 0,
    ...patch,
  };
}

function statefulStorage(initialValue: string | null): BuildTaskHistoryStorage {
  let value = initialValue;

  return {
    getItem: (key) => {
      assert.equal(key, BUILD_TASK_HISTORY_STORAGE_KEY);
      return value;
    },
    setItem: (key, nextValue) => {
      assert.equal(key, BUILD_TASK_HISTORY_STORAGE_KEY);
      value = nextValue;
    },
  };
}

test("keeps only the latest 20 valid build tasks", () => {
  const tasks = Array.from({ length: 25 }, (_, index) => buildTask(index));
  const loaded = readBuildTaskHistory(statefulStorage(JSON.stringify(tasks)));

  assert.equal(BUILD_TASK_HISTORY_LIMIT, 20);
  assert.equal(loaded.length, BUILD_TASK_HISTORY_LIMIT);
  assert.deepEqual(loaded.map((task) => task.id), Array.from({ length: 20 }, (_, index) => `build-${24 - index}`));
});

test("ignores corrupt records and invalid task history payloads", () => {
  const storage = statefulStorage(JSON.stringify([
    buildTask(1),
    { id: "broken" },
    "not-a-task",
    buildTask(2, { status: "unknown" } as unknown as Partial<BuildTask>),
  ]));

  assert.deepEqual(readBuildTaskHistory(storage).map((task) => task.id), ["build-1"]);
  assert.deepEqual(readBuildTaskHistory(statefulStorage("{")), []);
  assert.deepEqual(readBuildTaskHistory(statefulStorage(JSON.stringify({ tasks: [] }))), []);
});

test("marks tasks left running by a previous app session as interrupted", () => {
  const running = buildTask(3, { status: "running", finishedAt: undefined });
  const loaded = readBuildTaskHistory(statefulStorage(JSON.stringify([running])));

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].status, "canceled");
  assert.equal(loaded[0].error, "应用退出，任务已中断");
  assert.equal(loaded[0].finishedAt, undefined);
});

test("writes only the latest 20 tasks in newest-first order", () => {
  const storage = statefulStorage(null);

  writeBuildTaskHistory(storage, Array.from({ length: 25 }, (_, index) => buildTask(index)));

  const written = JSON.parse(storage.getItem(BUILD_TASK_HISTORY_STORAGE_KEY) ?? "[]") as BuildTask[];
  assert.equal(written.length, BUILD_TASK_HISTORY_LIMIT);
  assert.equal(written[0].id, "build-24");
  assert.equal(written.at(-1)?.id, "build-5");
});

test("task history persistence is best effort", () => {
  const storage: BuildTaskHistoryStorage = {
    getItem: () => {
      throw new Error("storage unavailable");
    },
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };

  assert.deepEqual(readBuildTaskHistory(storage), []);
  assert.deepEqual(readBuildTaskHistory(undefined), []);
  assert.doesNotThrow(() => writeBuildTaskHistory(storage, [buildTask(1)]));
  assert.doesNotThrow(() => writeBuildTaskHistory(undefined, [buildTask(1)]));
});

test("app hydrates, persists, and caps build task history", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /useState<BuildTask\[\]>\(\(\) => readBuildTaskHistory\(getBuildTaskHistoryStorage\(\)\)\)/);
  assert.match(source, /useEffect\(\(\) => \{\s*writeBuildTaskHistory\(getBuildTaskHistoryStorage\(\), buildTasks\);\s*\}, \[buildTasks\]\)/);
  assert.match(source, /\[task, \.\.\.current\]\.slice\(0, BUILD_TASK_HISTORY_LIMIT\)/);
});
