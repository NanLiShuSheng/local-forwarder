# 概览转发地址示例提示实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为概览中的 hq、jy、zx 空转发地址输入框显示指定的示例地址，同时保持示例值不参与配置保存。

**架构：** 在现有 `ConfigPages` 地址编辑器中增加一个按地址索引返回 placeholder 的纯函数，并将其绑定到已有的单一地址输入框。输入值、失焦保存、地址解析和历史记录逻辑不变；renderer 地址配置测试直接验证纯函数和 JSX 绑定。

**技术栈：** React、TypeScript、Node `node:test`、tsx、Vite。

---

## 文件清单

- 修改：`test/renderer/address-config.test.ts` — 增加 hq、jy、zx 示例地址的回归测试。
- 修改：`src/renderer/components/ConfigPages.tsx` — 定义示例地址映射和 placeholder 辅助函数，并替换地址输入框的通用提示。
- 不修改：配置模型、持久化、地址解析、CSS 及其他页面。

### 任务 1：先写空转发地址的失败测试

**文件：**

- 修改：`test/renderer/address-config.test.ts`

- [ ] **步骤 1：扩展导入并添加行为测试**

在现有 `ConfigPages` 导入列表中加入 `forwardingAddressPlaceholder`，并添加以下测试：

```ts
test("uses target-specific examples when forwarding address inputs are empty", async () => {
  assert.equal(forwardingAddressPlaceholder(0), "60.12.9.58:7778");
  assert.equal(forwardingAddressPlaceholder(1), "123.103.83.82:6064");
  assert.equal(forwardingAddressPlaceholder(2), "123.103.83.82:6064");

  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  assert.match(source, /placeholder=\{forwardingAddressPlaceholder\(index\)\}/);
  assert.doesNotMatch(source, /value=\{forwardingAddressPlaceholder\(index\)\}/);
});
```

该测试同时锁定三个地址类型的精确值，以及示例只绑定到 `placeholder`、不会替代实际 `value` 的约束。

- [ ] **步骤 2：运行测试确认它因功能缺失而失败**

运行：

```bash
npx tsx --test test/renderer/address-config.test.ts
```

预期：新增测试失败，原因是 `ConfigPages` 尚未导出 `forwardingAddressPlaceholder`；其余现有测试的结果作为基线记录，不修改测试来绕过失败。

### 任务 2：实现按 hq、jy、zx 区分的 placeholder

**文件：**

- 修改：`src/renderer/components/ConfigPages.tsx:26` 附近的地址常量及 `page === "addresses"` 的输入框。

- [ ] **步骤 1：增加最小映射和纯函数**

紧邻 `addressLabels` 增加：

```ts
const forwardingAddressPlaceholders = {
  hq: "60.12.9.58:7778",
  jy: "123.103.83.82:6064",
  zx: "123.103.83.82:6064",
} as const;

export function forwardingAddressPlaceholder(index: number): string | undefined {
  const key = addressLabels[index];
  return key === undefined ? undefined : forwardingAddressPlaceholders[key];
}
```

在地址输入框中将现有的：

```tsx
placeholder="例如 https://h5khtest.citics.com/ant"
```

替换为：

```tsx
placeholder={forwardingAddressPlaceholder(index)}
```

保留 `value={draft.address}`、`onChange` 和 `onBlur` 原样，确保 placeholder 不会被保存。

- [ ] **步骤 2：运行地址配置测试确认通过**

运行：

```bash
npx tsx --test test/renderer/address-config.test.ts
```

预期：该文件中的所有测试通过，新增测试报告三个目标地址均匹配。

### 任务 3：完成构建、全量测试和变更检查

**文件：**

- 检查：`src/renderer/components/ConfigPages.tsx`
- 检查：`test/renderer/address-config.test.ts`

- [ ] **步骤 1：运行项目构建**

运行：

```bash
npm run build
```

预期：TypeScript 类型检查和 Vite 构建均以退出码 0 完成。

- [ ] **步骤 2：运行完整测试套件**

运行：

```bash
npm test
```

预期：构建与全部 Node 测试成功，退出码为 0。

- [ ] **步骤 3：检查差异与范围**

运行：

```bash
git diff --check -- src/renderer/components/ConfigPages.tsx test/renderer/address-config.test.ts
git diff -- src/renderer/components/ConfigPages.tsx test/renderer/address-config.test.ts
```

确认只包含按目标类型显示 placeholder 的变更，且 `draft.address` 仍是输入框的 `value`，没有把示例地址写入默认草稿或保存逻辑。

- [ ] **步骤 4：提交实现变更**

```bash
git add src/renderer/components/ConfigPages.tsx test/renderer/address-config.test.ts
git commit -m "fix: show target forwarding address examples"
```
