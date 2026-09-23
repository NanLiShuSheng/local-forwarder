import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Windows resource smoke sends requests to the helper over stdin", async () => {
  const { invokeTzt } = await import("../../scripts/invoke-tzt-helper.mjs");
  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-tzt-test-"));
  const helperPath = path.join(temporaryDir, "helper.js");
  const request = { method: "rc4", data: "cGF5bG9hZA==", key: "file" };

  await writeFile(
    helperPath,
    'const fs = require("node:fs"); process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0, "utf8"))));',
  );

  try {
    const response = await invokeTzt(process.execPath, helperPath, request, { timeout: 2000 });
    assert.deepEqual(response, request);
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }
});
