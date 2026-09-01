# 侧栏 Tab 选中高亮实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为左侧功能导航的选中 tab 增加主题一致的左侧强调条、选中底色和清晰焦点环。

**架构：** 复用现有 `.sidebar-nav button` 与主题 CSS token，不改 React 路由、主题状态、代理配置或 IPC。基础 tab 预留透明左边框，选中态只切换边框颜色、文字色和选中背景，避免布局跳动。

**技术栈：** React renderer、CSS 自定义属性、Node test runner、tsx。

---

## 文件清单

- 修改：`src/renderer/styles.css` — 为侧栏 tab 增加透明占位边框、选中强调条和焦点环。
- 修改：`test/renderer/theme.test.ts` — 增加侧栏选中态与主题 token 的 CSS 契约测试。

当前 worktree 有其他既有未提交改动。执行时只暂存上面两个文件，不能使用 `git add .`。

### 任务 1：补充侧栏选中态失败测试

**文件：**
- 修改：`test/renderer/theme.test.ts`

- [ ] **步骤 1：编写失败的 CSS 契约测试**

在现有主题样式测试后加入：

```ts
test("sidebar navigation selected state uses the theme accent without layout shift", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const baseRule = extractCssRule(source, ".sidebar-nav button");
  const selectedRule = extractCssRule(source, ".sidebar-nav button.active");
  const focusRule = extractCssRule(source, ".sidebar-nav button:focus-visible");

  assert.match(baseRule, /border-left:\s*3px\s+solid\s+transparent/);
  assert.match(selectedRule, /border-left:\s*3px\s+solid\s+var\(--border-selected\)/);
  assert.match(selectedRule, /color:\s*var\(--text-bright\)/);
  assert.match(selectedRule, /background:\s*var\(--surface-selected-background\)/);
  assert.match(focusRule, /outline:\s*2px\s+solid\s+var\(--focus-ring\)/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx tsx --test test/renderer/theme.test.ts
```

预期：现有 28 项测试通过，新测试失败，因为当前样式没有独立的 `.sidebar-nav button.active` 和 `:focus-visible` 规则，也没有透明左边框占位。

- [ ] **步骤 3：Commit 测试契约**

```bash
git add test/renderer/theme.test.ts
git commit -m "test: specify sidebar tab highlight state"
```

### 任务 2：实现主题一致的侧栏高亮

**文件：**
- 修改：`src/renderer/styles.css`

- [ ] **步骤 1：增加无跳动的基础 tab 边框占位**

将现有基础规则：

```css
.sidebar-nav button { border: 0; border-radius: 8px; padding: 10px 10px; color: var(--text-subtle); background: transparent; text-align: left; font-size: 0.86rem; }
```

改为保留 3px 左侧空间：

```css
.sidebar-nav button { border: 0; border-left: 3px solid transparent; border-radius: 8px; padding: 10px 10px; color: var(--text-subtle); background: transparent; text-align: left; font-size: 0.86rem; }
```

- [ ] **步骤 2：实现选中态和键盘焦点态**

将现有 hover/active 规则拆分为明确的选中规则，并增加焦点环：

```css
.sidebar-nav button:hover { color: var(--text-bright); background: var(--surface-selected-background); }
.sidebar-nav button.active { border-left-color: var(--border-selected); color: var(--text-bright); background: var(--surface-selected-background); }
.sidebar-nav button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
```

使用现有 `--border-selected` 让深色主题使用浅绿色强调条、浅色主题使用深绿色强调条；不增加新的状态变量，不修改导航 DOM 或页面行为。

- [ ] **步骤 3：运行专项测试确认通过**

运行：

```bash
npx tsx --test test/renderer/theme.test.ts
npx tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：主题测试 29/29、侧栏/代理面板测试全部通过。

- [ ] **步骤 4：Commit 样式实现**

```bash
git add src/renderer/styles.css
git commit -m "fix: improve sidebar tab highlight"
```

### 任务 3：完整验证

**文件：** 无新增修改。

- [ ] **步骤 1：运行 renderer 专项测试**

```bash
npx tsx --test test/renderer/theme.test.ts
npx tsx --test test/renderer/chinese-ui.test.ts
npx tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：全部通过，主题测试 29/29。

- [ ] **步骤 2：运行构建和全量测试**

```bash
npm run build
npm test
```

预期：构建成功；全量测试 264 项基线加本次契约测试通过（具体总数以当前 worktree 实际输出为准）。

- [ ] **步骤 3：检查差异并确认未吸收其他改动**

```bash
git diff --check
git status --short
git log --oneline -4
```

预期：diff-check 无输出；主题提交只包含 `styles.css` 和 `theme.test.ts`，既有其他未提交改动仍保留。

