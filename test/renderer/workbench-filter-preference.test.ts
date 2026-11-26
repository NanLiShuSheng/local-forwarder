import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_WORKBENCH_INSTANCE_FILTER,
  WORKBENCH_INSTANCE_FILTER_STORAGE_KEY,
  readWorkbenchInstanceFilter,
  writeWorkbenchInstanceFilter,
  type WorkbenchFilterStorage,
} from "../../src/renderer/workbench-filter-preference";

function memoryStorage(initial: Record<string, string> = {}): WorkbenchFilterStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

test("workbench instance filter defaults to all", () => {
  assert.equal(DEFAULT_WORKBENCH_INSTANCE_FILTER, "all");
  assert.equal(readWorkbenchInstanceFilter(memoryStorage()), "all");
});

test("workbench instance filter remembers each supported filter", () => {
  const storage = memoryStorage();

  for (const filter of ["running", "stopped", "error", "all"] as const) {
    writeWorkbenchInstanceFilter(storage, filter);
    assert.equal(storage.values.get(WORKBENCH_INSTANCE_FILTER_STORAGE_KEY), filter);
    assert.equal(readWorkbenchInstanceFilter(storage), filter);
  }
});

test("workbench instance filter ignores invalid or unavailable storage", () => {
  assert.equal(readWorkbenchInstanceFilter(memoryStorage({ [WORKBENCH_INSTANCE_FILTER_STORAGE_KEY]: "invalid" })), "all");
  assert.equal(readWorkbenchInstanceFilter(undefined), "all");

  const broken: WorkbenchFilterStorage = {
    getItem: () => { throw new Error("unavailable"); },
    setItem: () => { throw new Error("unavailable"); },
  };
  assert.equal(readWorkbenchInstanceFilter(broken), "all");
  assert.doesNotThrow(() => writeWorkbenchInstanceFilter(broken, "running"));
});

test("workbench hydrates and persists the selected instance filter", async () => {
  const source = await readFile("src/renderer/components/WorkspacePages.tsx", "utf8");

  assert.match(source, /useState<WorkbenchInstanceFilter>\(\(\) => readWorkbenchInstanceFilter\(getWorkbenchFilterStorage\(\)\)\)/);
  assert.match(source, /const selectInstanceFilter = \(filter: WorkbenchInstanceFilter\) => \{[\s\S]*?setInstanceFilter\(filter\);[\s\S]*?writeWorkbenchInstanceFilter\(getWorkbenchFilterStorage\(\), filter\);/);
  assert.match(source, /onClick=\{\(\) => selectInstanceFilter\(value\)\}/);
});
