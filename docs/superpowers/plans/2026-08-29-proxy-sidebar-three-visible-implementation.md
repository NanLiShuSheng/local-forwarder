# 左侧代理列表最多显示三个实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让左侧代理列表最多同时显示 3 张代理卡片，超过 3 个时只在列表区域纵向滚动。

**架构：** 保持 `ProxyInstanceSidebar` 的实例渲染和所有操作回调不变，仅通过 `styles.css` 为列表设置固定卡片行高、按 3 行计算的可视高度和纵向滚动。使用现有 renderer 源码契约测试验证样式约束，避免引入运行时逻辑或新数据结构。

**技术栈：** React、TypeScript、CSS、Node `node:test`。

---

## 文件清单

- 修改：`test/renderer/proxy-instance-panel.test.ts` — 增加“3 张卡片可视高度”样式契约。
- 修改：`src/renderer/styles.css` — 将代理列表从 350px 最大高度调整为 3 张 64px 卡片加间距和内边距的高度，并固定隐式网格行高。
- 不修改：`src/renderer/components/ProxyInstanceSidebar.tsx` — 保持所有代理实例都渲染，继续由 CSS 负责裁剪和滚动。

### 任务 1：先为三卡片高度写失败测试

**文件：**

- 修改：`test/renderer/proxy-instance-panel.test.ts`，在现有 `proxy instances live in the sidebar...` 测试后新增独立测试。

- [ ] **步骤 1：编写失败的测试**

新增测试读取 `src/renderer/styles.css`，断言 `.proxy-instance-sidebar-list` 规则包含 `grid-auto-rows: 64px`，并包含按 3 张卡片、2 个间距和上下 6px 内边距计算的 `max-height`；同时断言仍使用 `overflow-y: auto`。

```ts
test("proxy sidebar shows three cards before scrolling", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*grid-auto-rows:\s*64px/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*max-height:\s*calc\(\(64px \* 3\) \+ \(8px \* 2\) \+ 6px\)/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*overflow-y:\s*auto/);
});
```

- [ ] **步骤 2：运行测试确认正确失败**

运行：

```bash
npx tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：新增测试 FAIL，原因是当前列表仍为 `max-height: 350px` 且没有 `grid-auto-rows: 64px`；其余现有测试保持通过。

### 任务 2：实现代理列表的三卡片可视高度

**文件：**

- 修改：`src/renderer/styles.css:20` 的 `.proxy-instance-sidebar-list` 规则。

- [ ] **步骤 1：写入最少 CSS 实现**

将现有规则中的 `gap: 8px; max-height: 350px;` 调整为固定卡片行高和三卡片高度计算，保留现有 `min-width`、`overflow-y`、内边距及滚动条样式：

```css
.proxy-instance-sidebar-list { display: grid; grid-auto-rows: 64px; gap: 8px; max-height: calc((64px * 3) + (8px * 2) + 6px); min-width: 0; overflow-y: auto; padding: 2px 5px 4px 2px; scrollbar-color: #536b88 #101d31; scrollbar-width: thin; }
```

所有 `instances.map(...)`、卡片点击/双击、删除按钮和侧栏导航代码保持不变；这保证第 4 个实例仍存在于 DOM 中，只是需要滚动才能看到。

- [ ] **步骤 2：运行目标测试确认通过**

运行：

```bash
npx tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：该文件全部 PASS。

- [ ] **步骤 3：检查差异并提交功能改动**

运行：

```bash
git diff --check
git diff -- src/renderer/styles.css test/renderer/proxy-instance-panel.test.ts
git add src/renderer/styles.css test/renderer/proxy-instance-panel.test.ts
git commit -m "feat: limit proxy sidebar to three visible cards"
```

预期：差异检查无输出，提交只包含列表样式和对应 renderer 测试。

### 任务 3：运行完整验证

**文件：** 无新增文件。

- [ ] **步骤 1：运行完整构建和测试**

运行：

```bash
npm test
```

预期：TypeScript 构建、Vite 构建以及全部 Node 测试通过。

- [ ] **步骤 2：检查工作树**

运行：

```bash
git status --short
```

预期：除实现前已存在的用户改动外，没有由本任务产生的未提交文件。
