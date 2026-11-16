# 日志选中态优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:test-driven-development。当前工作树包含用户已有未提交改动，实施时只编辑下列功能范围，不要重置、覆盖或提交其他改动。

**目标：** 将日志选中态改为仅使用浅绿色背景，避免左侧装饰遮挡时间文字，并将日志时间固定为 24 小时制。

**架构：** 保留 `LogPanel` 现有的选中 class、`aria-current`、点击选择和详情逻辑，只调整时间格式化调用与 `.log-row` 的视觉样式。所有行统一增加左侧内边距，选中行不再绘制左侧阴影或边框。

**技术栈：** React、TypeScript、原生 CSS、Node.js `node:test`、tsx。

---

## 文件清单

- 修改 `src/renderer/components/LogPanel.tsx`：将日志列表时间格式化为 24 小时制。
- 修改 `src/renderer/styles.css`：给日志行增加左侧内边距，保留选中背景并移除左侧内阴影。
- 修改 `test/renderer/log-panel.test.ts`：增加时间格式与选中态 CSS 回归断言。

### 任务 1：为日志选中态和时间格式增加失败测试

**文件：**

- 修改：`test/renderer/log-panel.test.ts:132-137`

- [ ] **步骤 1：编写失败的测试**

在现有 `log panel marks the selected log row with an accessible selected state` 测试中同时读取组件和样式，并加入以下断言：

```ts
const [markup, panelSource, styles] = await Promise.all([
  Promise.resolve(renderLogListWithSelectedEntry()),
  readFile("src/renderer/components/LogPanel.tsx", "utf8"),
  readFile("src/renderer/styles.css", "utf8"),
]);
assert.match(markup, /class="log-row selected"/);
assert.match(markup, /aria-current="true"/);
assert.match(panelSource, /toLocaleTimeString\(undefined, \{ hour12: false \}\)/);
assert.match(styles, /\.log-row\s*\{[^}]*padding:\s*9px 0 9px 8px;/);
assert.match(styles, /\.log-row:hover, \.log-row\.selected\s*\{[^}]*background:\s*var\(--selection-background\)/);
assert.doesNotMatch(styles, /\.log-row\.selected\s*\{[^}]*box-shadow:/);
```

保留测试文件现有的 `readFile` 导入；由于生产代码仍使用默认时间格式、旧 padding 和 `box-shadow`，该测试必须失败。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
npx tsx --test test/renderer/log-panel.test.ts
```

预期：`log panel marks the selected log row with an accessible selected state` 失败，失败原因应至少包含缺少 `{ hour12: false }`、新 padding 或仍存在 `box-shadow`，其余既有日志测试不因测试写法错误而报错。

### 任务 2：实现 24 小时制和无遮挡选中态

**文件：**

- 修改：`src/renderer/components/LogPanel.tsx:109`
- 修改：`src/renderer/styles.css:463-465`

- [ ] **步骤 1：修改时间格式化调用**

将日志行中的时间渲染从：

```tsx
<time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
```

改为：

```tsx
<time>{new Date(entry.timestamp).toLocaleTimeString(undefined, { hour12: false })}</time>
```

- [ ] **步骤 2：修改日志行样式**

将日志行 padding 从：

```css
padding: 9px 0;
```

改为：

```css
padding: 9px 0 9px 8px;
```

将选中规则从：

```css
.log-row.selected { color: var(--text-bright); box-shadow: inset 3px 0 0 var(--border-selected); }
```

改为：

```css
.log-row.selected { color: var(--text-bright); }
```

不修改 `.log-row:hover, .log-row.selected` 的浅绿色背景声明，也不修改 `aria-current` 或筛选逻辑。

- [ ] **步骤 3：运行测试验证通过**

运行：

```bash
npx tsx --test test/renderer/log-panel.test.ts
```

预期：该文件所有测试通过，且输出 `0` failures。

### 任务 3：运行相关回归和构建验证

**文件：** 无新增文件。

- [ ] **步骤 1：运行 renderer 回归测试**

运行：

```bash
npx tsx --test test/renderer/address-config.test.ts test/renderer/chinese-ui.test.ts test/renderer/encryption-panel.test.ts test/renderer/json-preview.test.ts test/renderer/log-type-preference.test.ts test/renderer/navigation.test.ts test/renderer/proxy-instance-panel.test.ts test/renderer/request-panel.test.ts test/renderer/string-tool.test.ts test/renderer/theme.test.ts test/renderer/log-panel.test.ts
```

预期：所有 renderer 测试通过；若共享日志白名单测试在混合工作树中出现失败，只记录其既有来源，不修改 `src/shared/log-types.ts` 或 `test/shared/log-types.test.ts`。

- [ ] **步骤 2：运行生产构建**

运行：

```bash
npm run build
```

预期：Electron 类型检查、renderer 类型检查和 Vite 构建均以退出码 0 完成。

- [ ] **步骤 3：检查差异格式**

运行：

```bash
git diff --check
```

预期：无空白错误。由于 `src/renderer/components/LogPanel.tsx`、`src/renderer/styles.css` 和 `test/renderer/log-panel.test.ts` 同时含有用户已有未提交改动，本次不执行针对这些整文件的 commit，避免把用户改动一并提交。
