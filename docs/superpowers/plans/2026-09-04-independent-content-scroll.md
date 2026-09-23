# 左右内容独立滚动实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让右侧内容区和左侧侧栏在视口内分别滚动，避免右侧滚动时左侧跟随页面整体移动。

**架构：** 将 `.app-shell` 约束为窗口视口高度并隐藏外层溢出；将 `.sidebar` 与 `.content` 设为两个独立的垂直滚动容器。保留代理实例列表现有的内部滚动，并通过 CSS 契约测试锁定布局行为，不引入滚轮事件处理或 React 状态。

**技术栈：** CSS、React renderer、Node `node:test`、TypeScript/tsx。

---

## 文件清单

- 修改：`src/renderer/styles.css` — 为应用根布局、左侧栏和右侧内容区设置视口高度、flex 收缩和独立垂直滚动。
- 修改：`test/renderer/proxy-instance-panel.test.ts` — 增加布局 CSS 契约测试，覆盖外层溢出隔离、两侧滚动容器和现有实例列表滚动。

现有未提交文件较多，执行时只暂存上述两个源码/测试文件；不覆盖或整理其他工作树改动。

### 任务 1：用失败测试锁定独立滚动契约

**文件：**
- 修改：`test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 1：增加失败测试**

在现有测试末尾增加以下测试。它读取真实 renderer CSS，验证根布局不会再成为共同滚动容器，左右两栏都可以在视口内收缩和垂直滚动，右侧还隔离滚动边界；最后一项保证现有代理实例列表的滚动规则没有被移除。

```ts
test("sidebar and content scroll independently within the viewport", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(styles, /\.app-shell\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
  assert.match(styles, /\.sidebar\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  assert.match(styles, /\.content\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/);
  assert.match(styles, /\.proxy-instance-sidebar-list[^}]*overflow-y:\s*auto/);
});
```

- [ ] **步骤 2：运行测试确认它因功能缺失失败**

运行：

```bash
node --import tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：测试进程正常启动，但新增测试失败，失败原因是当前 `.app-shell`、`.sidebar` 或 `.content` 缺少上述独立滚动 CSS，而不是模块加载错误。

### 任务 2：实现最小 CSS 布局修复

**文件：**
- 修改：`src/renderer/styles.css:6-7,153,195`

- [ ] **步骤 1：锁定应用根布局高度并阻止页面级滚动**

在 `.app-shell` 现有主题变量之后，将布局基础属性调整为：

```css
.app-shell {
  /* existing theme variables remain unchanged */
  height: 100vh;
  min-height: 0;
  display: flex;
  overflow: hidden;
  /* existing color, color-scheme, and background declarations remain unchanged */
}
```

不要修改主题变量、颜色、布局方向或页面 DOM。

- [ ] **步骤 2：让左侧栏成为独立滚动区**

保留 `.sidebar` 的宽度、padding、边框和背景，仅将其尺寸与溢出属性调整为：

```css
.sidebar {
  width: 294px;
  flex: 0 0 294px;
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  overflow-y: auto;
  /* existing padding, border-right, and background declarations remain unchanged */
}
```

这样左侧实例列表继续使用自身的 `.proxy-instance-sidebar-list` 滚动；当左侧导航整体超过窗口高度时，侧栏本身可以独立滚动。

- [ ] **步骤 3：让右侧内容成为独立滚动区并隔离滚动边界**

保留 `.content` 的 flex 宽度、居中和 padding，仅补充以下布局属性：

```css
.content {
  flex: 1;
  min-width: 0;
  width: min(1180px, 100%);
  height: 100vh;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  /* existing margin, padding, and background declarations remain unchanged */
}
```

不要给 `.content` 增加 JavaScript 滚动监听，也不要移除现有页面内部的 `overflow: auto` 区域。

### 任务 3：验证行为并提交代码

**文件：**
- 修改：`src/renderer/styles.css`
- 修改：`test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 1：运行目标 renderer 测试确认通过**

运行：

```bash
node --import tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：该测试文件全部通过，新增独立滚动契约测试 PASS。

- [ ] **步骤 2：运行 renderer 测试集合**

运行：

```bash
node --import tsx --test $(rg --files test/renderer -g '*.test.ts' | sort)
```

预期：所有 renderer 测试通过，既有代理侧栏、主题、JSON、日志和页面导航契约不受影响。

- [ ] **步骤 3：运行生产构建和全量测试**

依次运行：

```bash
npm run build
npm test
git diff --check
```

预期：构建退出码为 0；全量测试无失败；`git diff --check` 无输出。若全量测试发现与本次布局无关的既有工作树问题，记录具体失败文件和错误，不修改无关代码。

- [ ] **步骤 4：检查差异范围**

运行：

```bash
git diff -- src/renderer/styles.css test/renderer/proxy-instance-panel.test.ts
git status --short
```

确认差异只包含独立滚动 CSS、对应契约测试以及本计划之外已存在的用户改动；不要将其他用户文件加入暂存区。

- [ ] **步骤 5：提交本次代码变更**

只暂存本次两个文件并提交：

```bash
git add -- src/renderer/styles.css test/renderer/proxy-instance-panel.test.ts
git commit -m "fix: isolate sidebar and content scrolling"
```
