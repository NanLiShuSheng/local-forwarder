import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("test script delegates file discovery to the cross-platform Node runner", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as { scripts: Record<string, string> };
  const testScript = packageJson.scripts.test ?? "";
  assert.match(testScript, /scripts\/run-tests\.mjs/);
  assert.doesNotMatch(testScript, /\$\(|rg --files|\|/);
});
