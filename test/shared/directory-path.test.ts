import assert from "node:assert/strict";
import test from "node:test";
import { parseDirectoryInput } from "../../src/shared/directory-path";

test("parses a copied local file URL into the same absolute path as directory selection", () => {
  assert.equal(parseDirectoryInput("file:///Users/test/My%20Project"), "/Users/test/My Project");
});

test("keeps an absolute directory path unchanged", () => {
  assert.equal(parseDirectoryInput("/Users/test/project"), "/Users/test/project");
});

test("rejects remote URLs, relative paths, and empty input", () => {
  assert.throws(() => parseDirectoryInput("https://example.test/project"), /本地 file URL/);
  assert.throws(() => parseDirectoryInput("project"), /目录路径无效/);
  assert.throws(() => parseDirectoryInput(""), /目录路径无效/);
});
