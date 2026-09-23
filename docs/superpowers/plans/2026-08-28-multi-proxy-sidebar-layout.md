# 多代理侧栏布局实现计划

> **面向 AI 代理的工作者：** 本计划在当前 worktree 内执行，采用测试先行和增量验证。

**目标：** 将代理实例列表移入左侧栏，在固定最大高度区域内滚动，并将概览、请求、加密等功能 Tab 放到代理列表下方。

**架构：** 新增独立的 `ProxyInstanceSidebar` 负责代理列表和新增入口；保留 `ProxyInstancePanel` 负责右侧当前代理概览和启停/复制操作。`App` 负责把代理列表、功能导航和当前页面组合到同一个侧栏布局中。

**技术栈：** React、TypeScript、现有 CSS、Node 内置测试。

---

### 任务 1：覆盖侧栏布局和组件职责

**文件：**
- 创建：`src/renderer/components/ProxyInstanceSidebar.tsx`
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/ProxyInstancePanel.tsx`
- 测试：`test/renderer/proxy-instance-panel.test.ts`

- [ ] 编写测试，要求 App 渲染独立代理侧栏，功能导航仍包含概览、请求、加密、日志，代理实例卡片包含选中状态、端口、上游地址和新增入口。
- [ ] 运行专项测试确认新断言失败。
- [ ] 实现代理侧栏组件，并把原有代理管理列表从右侧概览移出；右侧保留当前代理信息和操作。
- [ ] 运行专项测试确认通过。

### 任务 2：实现固定高度和滚动视觉

**文件：**
- 修改：`src/renderer/styles.css`
- 测试：`test/renderer/proxy-instance-panel.test.ts`

- [ ] 为侧栏代理列表增加最大高度、内部滚动、选中卡片和下方功能导航样式断言。
- [ ] 实现侧栏宽度、代理列表最大高度和滚动条样式，并保留窄窗口下的可用布局。
- [ ] 运行 renderer 专项测试和类型检查。

### 任务 3：全量验证

**文件：**
- 验证：`src/renderer/App.tsx`
- 验证：`src/renderer/components/ProxyInstanceSidebar.tsx`
- 验证：`src/renderer/components/ProxyInstancePanel.tsx`
- 验证：`src/renderer/styles.css`

- [x] 运行 `npm test`，确认请求、加密、缓存和多代理行为没有回归。
- [x] 运行 `git diff --check`，确认本轮差异无空白错误。

本轮用户只要求修改布局，因此不自动打包或覆盖安装应用；如需安装，再单独执行打包和安装流程。
