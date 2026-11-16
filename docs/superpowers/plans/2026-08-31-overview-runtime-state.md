# 概览运行态与代理列表布局实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让运行中的概览配置和名称不可编辑、停止按钮复用“一键关闭”危险样式，并让左侧代理列表的状态紧跟名称、端口固定右对齐。

**架构：** 保持现有 `ProxyInstancePanel`、`ProxyInstanceSidebar` 和单文件 CSS 结构，不增加 IPC 或数据模型。运行态由现有 `status.state` 驱动：运行中禁用概览输入和目录选择，停止后恢复；侧栏仅通过 JSX 顺序和 flex 约束完成排版。

**技术栈：** React、TypeScript、Vite、Node test runner、CSS contract tests。

---

### 任务 1：为运行态和列表布局补充失败的 renderer contract 测试

**文件：**
- 修改：`test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 1：编写失败测试**

在现有 overview 测试文件中新增以下断言，替换当前仍要求 `disabled={busy}` 且禁止运行态禁用表达式的旧断言：

```ts
test("overview disables editable data while the proxy is running", async () => {
  const panel = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  const disabledControls = panel.match(/disabled=\{running \|\| busy\}/g) ?? [];
  assert.equal(disabledControls.length, 6);
  assert.match(panel, /className=\{running \? "proxy-instance-sidebar-action stop" : "primary-button"\}/);
});

test("proxy sidebar keeps status after the name and pins the port to the right", async () => {
  const sidebar = await readFile("src/renderer/components/ProxyInstanceSidebar.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.ok(sidebar.indexOf("proxy-instance-sidebar-name") < sidebar.indexOf("proxy-instance-sidebar-status"));
  assert.ok(sidebar.indexOf("proxy-instance-sidebar-status") < sidebar.indexOf("instance.port"));
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*flex:\s*0 0 auto/);
  assert.match(styles, /\.proxy-instance-sidebar-title code[^}]*text-align:\s*right/);
});
```

保持测试只检查可观察的 renderer contract：概览控件的禁用属性、危险按钮类名、侧栏 DOM 顺序及端口 CSS 约束。

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
node --import tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：FAIL。当前概览名称、配置输入和目录选择未统一使用运行态禁用条件，概览停止按钮仍使用 `secondary-button`，端口 CSS 没有显式的 `flex: 0 0 auto` 与 `text-align: right` contract。

- [ ] **步骤 3：Commit 测试变更**

```bash
git add test/renderer/proxy-instance-panel.test.ts
git commit -m "test: define overview runtime disabled state"
```

### 任务 2：实现概览运行态禁用和停止按钮样式

**文件：**
- 修改：`src/renderer/components/ProxyInstancePanel.tsx`

- [ ] **步骤 1：实现最少代码**

在组件中沿用现有 `busy`，将运行态条件直接用于概览所有可编辑控件：

```tsx
const running = status.state === "running";
```

将名称输入改为 `disabled={running || busy}`；项目目录输入、目录选择按钮、监听主机、监听端口和超时时间输入同样使用 `disabled={running || busy}`。保留现有 `onChange`、`onBlur` 和保存回调，避免新增业务逻辑。

将启停按钮的 className 改为：

```tsx
className={running ? "proxy-instance-sidebar-action stop" : "primary-button"}
```

这样运行中的概览停止按钮直接复用侧栏“一键关闭”的 `.stop` 样式，停止状态的“启动代理”继续使用原有主按钮样式。

- [ ] **步骤 2：运行目标测试确认通过**

运行：

```bash
node --import tsx --test test/renderer/proxy-instance-panel.test.ts
```

预期：新增运行态测试及既有概览 contract 全部 PASS。

- [ ] **步骤 3：Commit 组件变更**

```bash
git add src/renderer/components/ProxyInstancePanel.tsx test/renderer/proxy-instance-panel.test.ts
git commit -m "feat: disable overview edits while proxy runs"
```

### 任务 3：实现左侧代理卡片的状态与端口布局

**文件：**
- 修改：`src/renderer/styles.css`

- [ ] **步骤 1：实现最少 CSS 变更**

保留 `ProxyInstanceSidebar.tsx` 当前已满足的标题行顺序，在端口规则中补充不可压缩和右对齐约束：

```css
.proxy-instance-sidebar-title code {
  flex: 0 0 auto;
  min-width: 44px;
  margin-left: auto;
  color: #8fa4c0;
  font: 0.68rem ui-monospace, SFMono-Regular, Menlo, monospace;
  text-align: right;
}
```

不改变状态徽章颜色、卡片高度或目标地址展示，避免影响已完成的侧栏布局。

- [ ] **步骤 2：运行侧栏和全量 renderer 测试**

运行：

```bash
node --import tsx --test test/renderer/proxy-instance-panel.test.ts test/renderer/navigation.test.ts test/renderer/chinese-ui.test.ts
```

预期：全部 PASS，且端口右对齐 contract PASS。

- [ ] **步骤 3：Commit 样式变更**

```bash
git add src/renderer/styles.css
git commit -m "style: align proxy status and port"
```

### 任务 4：完整验证与需求核对

**文件：**
- 检查：`src/renderer/components/ProxyInstancePanel.tsx`
- 检查：`src/renderer/components/ProxyInstanceSidebar.tsx`
- 检查：`src/renderer/styles.css`
- 检查：`test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 1：运行完整构建和测试**

运行：

```bash
npm test
```

预期：TypeScript、Vite 构建成功，Node test runner 全部测试通过。

- [ ] **步骤 2：核对需求与工作区差异**

运行：

```bash
git diff --check HEAD~3..HEAD
git status --short
```

确认变更仅包含本计划产生的提交和用户原有工作区改动；不重置、不覆盖其他未提交文件。

- [ ] **步骤 3：按成功标准交付**

逐项确认：运行中概览名称与配置字段不可编辑；停止后恢复；概览停止按钮与“一键关闭”同为红色危险样式；左侧状态紧跟名称；端口固定右对齐。
