# JSON 可视化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Electron renderer 中新增“JSON 可视化”Tab，支持纯 JSON、带外层引号的转义 JSON 和常见转义对象文本，并提供树形、表格、原始 JSON 三种预览方式。

**架构：** JSON 文本解析、类型判断和扁平化路径计算放在无 UI 依赖的 `src/shared/json-preview.ts`；页面组件只负责编辑状态、视图切换、搜索、展开收起和复制交互。导航沿用现有 `App.tsx` 的页面数组和内联 SVG 图标，不引入第三方图标或状态管理依赖。

**技术栈：** React + TypeScript + 现有 CSS 变量主题；Node `node:test` + `tsx` 测试共享解析器和 renderer 静态契约。

---

### 任务 1：定义 JSON 解析与预览数据模型

**文件：**
- 创建：`src/shared/json-preview.ts`
- 创建：`test/shared/json-preview.test.ts`

- [ ] **步骤 1：编写失败测试**

测试 `parseJsonPreviewText` 和 `flattenJsonValue`：

```ts
test("parses pure JSON and returns formatted text and root metadata", () => {
  const result = parseJsonPreviewText('{"code":1,"records":[{"name":"查询成功"}]}');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source, "json");
    assert.equal(result.rootType, "object");
    assert.match(result.formatted, /\n  "records":/);
  }
});

test("parses a quoted escaped JSON response", () => {
  const result = parseJsonPreviewText('"{\\"code\\":1,\\"timeout\\":false}"');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { code: 1, timeout: false });
});

test("flattens nested values with JSON paths and types", () => {
  const rows = flattenJsonValue({ records: [{ id: 7, ok: true }], note: null });
  assert.deepEqual(rows.map((row) => [row.path, row.type]), [
    ["$.records", "array"], ["$.records[0]", "object"], ["$.records[0].id", "number"],
    ["$.records[0].ok", "boolean"], ["$.note", "null"],
  ]);
});

test("rejects malformed JSON with a user-facing error", () => {
  const result = parseJsonPreviewText('{"code":}');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /JSON/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/shared/json-preview.test.ts`

预期：失败，提示 `src/shared/json-preview` 尚不存在。

- [ ] **步骤 3：实现最少的数据层**

导出以下类型和函数：

```ts
export type JsonPreviewValue = null | boolean | number | string | JsonPreviewValue[] | { [key: string]: JsonPreviewValue };
export type JsonPreviewType = "object" | "array" | "string" | "number" | "boolean" | "null";
export interface JsonPreviewRow { path: string; key: string; value: JsonPreviewValue; type: JsonPreviewType; depth: number; }
export type JsonPreviewParseResult =
  | { ok: true; value: JsonPreviewValue; formatted: string; source: "json" | "escaped-json"; rootType: JsonPreviewType }
  | { ok: false; error: string };
export function parseJsonPreviewText(input: string): JsonPreviewParseResult;
export function jsonPreviewType(value: JsonPreviewValue): JsonPreviewType;
export function flattenJsonValue(value: JsonPreviewValue, path?: string, depth?: number): JsonPreviewRow[];
```

解析顺序固定为：去除首尾空白 → `JSON.parse` → 若结果是 JSON 字符串则再解析一次 → 若首次解析失败且文本含 `\\"`，仅尝试去除转义引号后再次解析。所有失败分支返回中文错误，不向 renderer 抛异常；格式化使用 `JSON.stringify(value, null, 2)`。

- [ ] **步骤 4：运行测试确认通过**

运行：`npx tsx --test test/shared/json-preview.test.ts`

预期：4 个测试全部通过。

### 任务 2：创建 JSON 可视化页面组件

**文件：**
- 创建：`src/renderer/components/JsonPreviewPage.tsx`
- 创建：`test/renderer/json-preview.test.ts`

- [ ] **步骤 1：编写失败的 renderer 契约测试**

断言页面包含 `json-preview-panel`、输入框、解析状态、`树形视图`、`表格视图`、`原始 JSON`、搜索、全部展开/收起和复制路径；同时断言解析逻辑来自 `json-preview.ts`，不访问 Electron API。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/renderer/json-preview.test.ts`

预期：失败，提示页面文件不存在。

- [ ] **步骤 3：实现页面行为**

页面内部维护 `inputText`、`parsed`、`activeView`、`searchText`、`expandedPaths` 和 `selectedPath`。默认输入使用用户给出的查询响应样例；输入变化实时解析，错误时保留文本并在右侧显示错误卡片。树形视图递归展示对象、数组和标量；表格使用 `flattenJsonValue` 展示路径、值、类型；原始视图展示格式化结果。复制动作优先使用 `navigator.clipboard.writeText`，不可用时显示“复制失败”。

长字符串在树形/表格单元格中截断为 160 个字符并附带长度，原始 JSON 保留完整值。搜索匹配 key、路径或字符串化后的值，并自动保留匹配节点的祖先；数组索引路径使用 `$.records[0]` 格式。

- [ ] **步骤 4：运行页面契约测试确认通过**

运行：`npx tsx --test test/renderer/json-preview.test.ts`

预期：页面结构和交互文案测试全部通过。

### 任务 3：接入页面类型、导航和主题样式

**文件：**
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/styles.css`
- 修改：`test/renderer/navigation.test.ts`

- [ ] **步骤 1：扩展导航契约测试**

要求 `Page` 包含 `json`，导航包含 `{ id: "json", label: "JSON 可视化", icon: "json" }`，App 在 `page === "json"` 时渲染 `JsonPreviewPage`，并且 `ConfigPages` 不接管该页面。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/renderer/navigation.test.ts`

预期：新增 JSON 导航断言失败。

- [ ] **步骤 3：接入并实现样式**

在 `ConfigPages.tsx` 的 `Page` 联合类型加入 `json`；在 `App.tsx` 导入组件、增加 JSON 图标路径、增加页面项，并排除 JSON 页面进入 `ConfigPages`。新增 `.json-preview-*` 样式，使用已有 `--panel-background`、`--surface-background`、`--code-background`、`--success`、`--danger` 等 token，保持暗色/亮色主题兼容；输入区和预览区在宽屏左右分栏，小窗口下改为上下布局。

- [ ] **步骤 4：运行导航和类型检查**

运行：`npx tsx --test test/renderer/navigation.test.ts` 和 `npm run build`

预期：测试通过，TypeScript 和 Vite 构建退出码为 0。

### 任务 4：完整验证和回归

**文件：**
- 修改：无；仅检查前述实现文件和测试文件

- [ ] **步骤 1：运行新增测试**

运行：`npx tsx --test test/shared/json-preview.test.ts test/renderer/json-preview.test.ts test/renderer/navigation.test.ts`

预期：新增 JSON 测试和导航测试全部通过。

- [ ] **步骤 2：运行完整测试套件**

运行：`npm test`

预期：构建成功，所有测试通过且失败数为 0。

- [ ] **步骤 3：检查变更边界**

运行：`git diff --check` 和 `git status --short`

预期：无空白错误；只报告本功能新增/修改文件及工作树中原有的用户改动，不覆盖或清理原有改动。
