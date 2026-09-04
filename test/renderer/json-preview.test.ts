import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("JSON preview page exposes the three views and core controls", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  for (const label of ["输入 JSON", "树形视图", "表格视图", "原始 JSON", "全部展开", "全部收起", "复制当前路径"]) {
    assert.equal(source.includes(label), true, `missing JSON preview control: ${label}`);
  }
  assert.match(source, /parseJsonPreviewText/);
  assert.match(source, /flattenJsonValue/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /type="file"/);
  assert.match(source, /file\.text\(\)/);
  assert.match(source, /json-preview-panel/);
  assert.match(source, /json-preview-tree/);
  assert.match(source, /json-preview-table/);
});

test("JSON preview page reports parse errors without calling Electron APIs", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.match(source, /JSON 解析失败/);
  assert.match(source, /parseResult\.error/);
  assert.doesNotMatch(source, /window\.forwarder/);
});

test("JSON preview keeps page-level heading text out of the compact workspace", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.doesNotMatch(source, /工具 \/ JSON/);
  assert.doesNotMatch(source, /粘贴接口响应，快速查看层级结构/);
  assert.match(source, /导入文件/);
  assert.match(source, /格式化/);
  assert.match(source, /清空/);
  assert.match(source, /复制格式化 JSON/);
  assert.match(source, /className="json-preview-card-actions"/);
});

test("JSON preview keeps the editor collapsed behind a compact input bar", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.match(source, /isEditorOpen/);
  assert.match(source, /json-preview-input-bar/);
  assert.match(source, /重新编辑/);
  assert.match(source, /收起编辑器/);
  assert.match(source, /json-preview-input-editor/);
});

test("JSON preview table supports expanding object and array rows", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.match(source, /tableExpandedPaths/);
  assert.match(source, /json-preview-table-toggle/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /row\.type === "object" \|\| row\.type === "array"/);
  assert.match(source, /tableVisibleRows/);
});

test("JSON preview exports the data preview through a native canvas", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.match(source, /createElement\("canvas"\)/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /导出图片/);
  assert.match(source, /json-preview-output-card/);
  assert.match(source, /download/);
  assert.match(source, /image\/png/);
  assert.match(source, /URL\.createObjectURL/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.doesNotMatch(source, /html-to-image/);
});

test("JSON preview places parse status beside the output title", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");

  const titleBlock = source.match(/<div className="json-preview-output-title">([\s\S]*?)<\/div>\s*<button className="secondary-button"/);
  assert.ok(titleBlock);
  assert.match(titleBlock[1], /<h3>数据预览<\/h3>\{parseResult\.ok \? <span className="json-preview-valid-label">● 有效 JSON<\/span> : <span className="json-preview-error-label">● \{parseError\}<\/span>\}/);
  assert.match(styles, /\.json-preview-output-title\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*8px;/s);
  assert.match(styles, /\.json-preview-input-summary h3,\s*\.json-preview-output-heading h3\s*\{\s*margin:\s*0;/);
});

test("JSON preview accepts and consumes one-time prefills", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.match(source, /import \{ useEffect, useMemo, useRef, useState \} from "react";/);
  assert.match(source, /prefillText\?: string/);
  assert.match(source, /onPrefillApplied\?: \(\) => void/);
  assert.match(source, /createJsonPrefillGuard/);
  assert.match(source, /prefillGuardRef/);
  assert.match(source, /updateInput\(prefillText\);/);
  assert.match(source, /onPrefillApplied\?\.\(\);/);
  assert.match(source, /\}, \[prefillText, onPrefillApplied\]\);/);
});

test("JSON preview keeps invalid prefill text while showing its parse error", async () => {
  const source = await readFile("src/renderer/components/JsonPreviewPage.tsx", "utf8");

  assert.match(source, /setInputText\(value\);[\s\S]*?const next = parseJsonPreviewText\(value\);[\s\S]*?setParseResult\(next\);/);
  assert.match(source, /setExpandedPaths\(next\.ok \? defaultExpandedPaths\(next\.value\) : new Set\(\["\$"\]\)\);/);
  assert.match(source, /JSON 解析失败/);
  assert.match(source, /parseResult\.error/);
});

test("JSON preview prefill guard applies one value once and resets after undefined", async () => {
  const module = await import("../../src/renderer/components/JsonPreviewPage") as unknown as {
    createJsonPrefillGuard?: unknown;
  };
  assert.equal(typeof module.createJsonPrefillGuard, "function");
  const createJsonPrefillGuard = module.createJsonPrefillGuard as () => (
    prefillText: string | undefined,
    updateInput: (text: string) => void,
    onPrefillApplied?: () => void,
  ) => void;
  const updates: string[] = [];
  let appliedCount = 0;
  const guard = createJsonPrefillGuard();
  const updateInput = (text: string) => updates.push(text);
  const onPrefillApplied = () => { appliedCount += 1; };

  guard('{"first":1}', updateInput, onPrefillApplied);
  guard('{"first":1}', updateInput, onPrefillApplied);
  assert.deepEqual(updates, ['{"first":1}']);
  assert.equal(appliedCount, 1);

  guard(undefined, updateInput, onPrefillApplied);
  guard('{"first":1}', updateInput, onPrefillApplied);
  assert.deepEqual(updates, ['{"first":1}', '{"first":1}']);
  assert.equal(appliedCount, 2);
});
