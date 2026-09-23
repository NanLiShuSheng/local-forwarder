# 侧栏移除“功能”标题实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `subagent-driven-development` 或 `executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 移除左侧功能 tab 上方可见的“功能”标题，同时保持 tab 布局、交互和无障碍语义不变。

**架构：** `App.tsx` 保留侧栏 `nav` 和 `aria-label`，删除可见标题节点；`styles.css` 用无内容伪元素保留标题原有占位高度，避免 tab 整体上移。通过 renderer contract 测试锁定“无可见标题、保留导航语义”的边界。

**技术栈：** React、TypeScript、CSS、Node test runner、tsx、Vite。

---

### 任务 1：增加可见标题移除的失败测试

**文件：**
- 修改：`test/renderer/navigation.test.ts`

- [ ] **步骤 1：在导航测试文件追加 contract 测试**

```ts
test("sidebar navigation removes the visible feature heading without changing its accessible name", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");

  assert.match(source, /<nav className="sidebar-nav" aria-label="功能导航">/);
  assert.doesNotMatch(source, /<span className="sidebar-nav-label">功能<\/span>/);
  assert.match(styles, /\.sidebar-nav::before/);
});
```

- [ ] **步骤 2：运行测试确认它先失败**

运行：

```bash
npx tsx --test test/renderer/navigation.test.ts
```

预期：新增测试 FAIL，因为 `App.tsx` 目前仍包含 `<span className="sidebar-nav-label">功能</span>`；现有“隐藏转发规则和缓存页面”测试保持 PASS。

### 任务 2：移除可见文案并保留原布局占位

**文件：**
- 修改：`src/renderer/App.tsx:252-255`
- 修改：`src/renderer/styles.css:187-189`

- [ ] **步骤 1：删除可见标题节点，保留无障碍导航名称**

将侧栏导航保留为以下结构：

```tsx
<nav className="sidebar-nav" aria-label="功能导航">
  {pages.map((item) => <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>{item.label}</button>)}
</nav>
```

- [ ] **步骤 2：用无内容伪元素复刻原标题占位高度**

保留 `.sidebar-nav` 的现有网格、边框和间距规则，删除 `.sidebar-nav-label` 规则，并追加：

```css
.sidebar-nav::before { content: ""; display: block; height: 0.66rem; margin: 0 10px 3px; }
```

该伪元素不渲染任何文字，只保留原标题的视觉高度；tab 按钮的选中、悬停和焦点规则不变。

### 任务 3：运行回归验证

**文件：** 无新增文件。

- [ ] **步骤 1：运行侧栏相关 renderer 测试**

运行：

```bash
npx tsx --test test/renderer/navigation.test.ts test/renderer/proxy-instance-panel.test.ts test/renderer/theme.test.ts
```

预期：所有列出的测试 PASS，确认导航语义、tab 结构和主题高亮没有回归。

- [ ] **步骤 2：运行完整构建**

运行：

```bash
npm run build
```

预期：TypeScript 类型检查和 Vite 构建均成功完成。

- [ ] **步骤 3：检查差异与空白字符**

运行：

```bash
git diff --check
git diff -- src/renderer/App.tsx src/renderer/styles.css test/renderer/navigation.test.ts
```

预期：差异只包含本任务涉及的三个文件；不会包含 worktree 中已有的其他用户改动。

### 任务 4：提交本次实现

**文件：** `src/renderer/App.tsx`、`src/renderer/styles.css`、`test/renderer/navigation.test.ts`

- [ ] **步骤 1：仅暂存本任务文件**

```bash
git add src/renderer/App.tsx src/renderer/styles.css test/renderer/navigation.test.ts
```

- [ ] **步骤 2：提交实现**

```bash
git commit -m "fix: remove sidebar feature label"
```

预期：创建一个只包含侧栏可见标题移除、布局占位和对应测试的提交；其他既有未提交改动保持原状。
