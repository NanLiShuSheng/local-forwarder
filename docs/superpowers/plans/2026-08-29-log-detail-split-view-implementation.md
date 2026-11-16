# 日志列表与详情同屏实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将日志列表和当前日志详情放入同一个双栏工作区，日志较多时只滚动列表区域，避免用户滚动整页查看详情。

**架构：** `LogPanel` 保持现有筛选、倒序和选中状态逻辑，只调整 JSX 结构，让日志列表和详情始终作为同一工作区的两个区域；未选中时详情区域显示空状态。CSS 为列表提供独立滚动高度，详情内容继续在代码块内部滚动，并在窄屏下折叠为上下布局。

**技术栈：** React、TypeScript、CSS、Node `node:test`。

---

## 文件清单

- 修改：`test/renderer/log-panel.test.ts` — 先增加双栏工作区、列表滚动和未选中详情状态的样式/结构契约。
- 修改：`src/renderer/components/LogPanel.tsx` — 保留日志逻辑，调整详情常驻于工作区并添加空状态。
- 修改：`src/renderer/styles.css` — 新增双栏工作区、列表独立滚动、详情高度和窄屏布局样式。
- 不修改：`src/shared/contracts.ts`、IPC 和日志筛选数据流。

### 任务 1：先为双栏日志工作区写失败测试

**文件：**

- 修改：`test/renderer/log-panel.test.ts`，在现有日志详情测试后新增独立测试。

- [ ] **步骤 1：编写失败的测试**

新增测试读取 `LogPanel.tsx` 和 `styles.css`，断言组件有 `log-workspace`、`log-detail-empty` 和“选择一条日志查看详情”，样式有双栏工作区、列表 `max-height: 520px`、列表 `overflow-y: auto`，并包含窄屏下的 `log-workspace` 单列规则。

```ts
test("log panel keeps the list visible beside the selected detail", async () => {
  const [panelSource, styleSource] = await Promise.all([
    readFile("src/renderer/components/LogPanel.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
  ]);
  assert.match(panelSource, /log-workspace/);
  assert.match(panelSource, /log-detail-empty/);
  assert.match(panelSource, /选择一条日志查看详情/);
  assert.match(styleSource, /\.log-workspace[^\{]*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 1\.05fr\)/);
  assert.match(styleSource, /\.log-list[^}]*max-height:\s*520px/);
  assert.match(styleSource, /\.log-list[^}]*overflow-y:\s*auto/);
  assert.match(styleSource, /@media[^\n]*\.log-workspace[^\n]*grid-template-columns:\s*1fr/);
});
```

- [ ] **步骤 2：运行测试确认正确失败**

运行：

```bash
npx tsx --test test/renderer/log-panel.test.ts
```

预期：现有测试通过，新增测试 FAIL，因为当前组件没有 `log-workspace`/空状态，CSS 没有列表独立滚动和双栏规则。

### 任务 2：实现日志双栏工作区

**文件：**

- 修改：`src/renderer/components/LogPanel.tsx`。

- [ ] **步骤 1：调整组件结构，保留现有数据逻辑**

保留 `visible` 的筛选、`.slice(-200).reverse()` 的数量与排序逻辑，以及日志行点击和详情关闭回调；将返回结构中的列表和详情放入同一个工作区，并让详情区域始终渲染：

```tsx
<div className="log-workspace">
  <div className="log-list">
    {visible.length === 0 ? <p className="empty">暂无日志。</p> : visible.map(/* 保持现有 log-row */)}
  </div>
  <section className="log-detail" aria-label="日志详情">
    {selected ? <>
      <div className="log-detail-heading">{/* 保持标题和关闭按钮 */}</div>
      <dl className="log-detail-list">{/* 保持请求参数和应答数据 */}</dl>
    </> : <p className="log-detail-empty">选择一条日志查看详情。</p>}
  </section>
</div>
```

不修改 `LogEntry` 类型、日志筛选条件、显示数量、倒序逻辑或详情字段默认值“无”。

- [ ] **步骤 2：运行组件测试确认结构仍可编译**

运行：

```bash
npx tsx --test test/renderer/log-panel.test.ts
```

预期：新增测试仍 FAIL，说明结构已经存在但 CSS 还未实现；不应出现 TypeScript/JSX 语法错误。

### 任务 3：实现列表独立滚动和响应式样式

**文件：**

- 修改：`src/renderer/styles.css` 的日志样式区域和现有 `@media (max-width: 820px)` 规则。

- [ ] **步骤 1：写入最少 CSS**

在 `.log-toolbar` 后加入工作区和滚动约束，保留原有 `.log-list` 的 `display: grid; gap: 8px`：

```css
.log-workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 1.05fr); gap: 16px; min-height: 0; }
.log-list { max-height: 520px; min-height: 0; overflow-y: auto; padding-right: 6px; scrollbar-color: #536b88 #101d31; scrollbar-width: thin; }
.log-list::-webkit-scrollbar { width: 6px; }
.log-list::-webkit-scrollbar-track { border-radius: 99px; background: #101d31; }
.log-list::-webkit-scrollbar-thumb { border-radius: 99px; background: #536b88; }
.log-detail { min-width: 0; min-height: 260px; margin-top: 0; }
.log-detail-empty { margin: 0; color: #8597b0; font-size: 0.8rem; }
```

在 `@media (max-width: 820px)` 中加入：

```css
.log-workspace { grid-template-columns: 1fr; }
.log-list { max-height: 320px; }
```

让详情内部已有 `.log-detail-body { max-height: 260px; overflow: auto; }` 继续负责长请求/响应内容，不增加页面级横向滚动。

- [ ] **步骤 2：运行日志测试确认通过**

运行：

```bash
npx tsx --test test/renderer/log-panel.test.ts
```

预期：该文件全部 PASS。

- [ ] **步骤 3：检查差异并提交日志功能**

运行：

```bash
git diff --check
git diff -- src/renderer/components/LogPanel.tsx src/renderer/styles.css test/renderer/log-panel.test.ts
git add src/renderer/components/LogPanel.tsx src/renderer/styles.css test/renderer/log-panel.test.ts
git commit -m "feat: keep log details beside log list"
```

预期：差异只包含日志组件、日志样式和日志测试。

### 任务 4：运行完整验证

**文件：** 无新增文件。

- [ ] **步骤 1：运行完整构建和测试**

运行：

```bash
npm test
```

预期：TypeScript 构建、Vite 构建和全部 Node 测试通过。

- [ ] **步骤 2：检查工作树**

运行：

```bash
git status --short
```

预期：除实现前已存在的用户改动外，没有由日志功能产生的未提交文件。
