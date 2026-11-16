# 全局 Toast 错误提示实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法进行跟踪。

**目标：** 将应用中的操作/运行错误统一显示为右下角 Toast，5 秒后自动隐藏并支持手动关闭，避免英文底层错误与中文页面错误重复出现。

**架构：** 在 renderer 根部增加 Toast Provider 和全局 Toast 视口；所有操作失败通过统一 `notifyError` 进入该视口，Toast 最多保留最近 3 条并按消息去重。新增用户可见错误归一化函数，将 `EADDRINUSE`、`ECONNREFUSED`、超时、权限和英文配置错误转换为中文；JSON 解析结果等内容区内嵌错误继续保留原位置。

**技术栈：** React hooks、TypeScript、现有 CSS 变量、Node `node:test`。

---

### 任务 1：定义错误归一化和 Toast 状态契约

**文件：**
- 创建：`src/renderer/toast.ts`
- 创建：`test/renderer/toast.test.ts`

- [ ] **步骤 1：编写失败测试**

测试 `TOAST_DURATION_MS === 5000`；测试 `toUserError("EADDRINUSE: address already in use 127.0.0.1:8080")` 返回只含中文的“端口 8080 已被占用”提示；测试 `toUserError("stop the service before changing configuration")` 返回“配置未保存，请先停止服务”；测试普通中文错误原样保留。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/renderer/toast.test.ts`

预期：因 `src/renderer/toast.ts` 不存在而失败。

- [ ] **步骤 3：实现最小纯函数**

导出 `TOAST_DURATION_MS = 5000`、`ToastKind`、`ToastRecord` 和 `toUserError(error, fallback)`；按错误码和英文关键词匹配中文消息，未知错误使用原始非空消息或 fallback。

- [ ] **步骤 4：运行测试确认通过**

运行：`npx tsx --test test/renderer/toast.test.ts`

预期：全部 PASS。

### 任务 2：实现右下角 Toast Provider

**文件：**
- 创建：`src/renderer/components/ToastProvider.tsx`
- 修改：`src/renderer/styles.css`
- 修改：`test/renderer/toast.test.ts`

- [ ] **步骤 1：补充失败契约测试**

检查 Provider 导出 `ToastProvider` 和 `useToast`，视口使用 `role="region"`、`aria-live="polite"`，Toast 使用错误/警告/成功类型 class；源码包含 `window.setTimeout`、`TOAST_DURATION_MS` 和手动关闭按钮。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/renderer/toast.test.ts`

预期：因 Provider 尚未存在而失败。

- [ ] **步骤 3：实现最小 Provider 和视口**

实现 `notify({ kind, title, message })`、`notifyError(error, fallback)` 和 `dismiss(id)`；每条 Toast 在创建后 5000ms 自动移除，重复消息更新已有 Toast 的时间而不无限堆叠，最多显示 3 条。视口固定在右下角，适配浅色/深色主题和窄窗口。

- [ ] **步骤 4：运行测试确认通过**

运行：`npx tsx --test test/renderer/toast.test.ts`

预期：全部 PASS。

### 任务 3：接入 App 和页面错误入口

**文件：**
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/RuntimePanel.tsx`
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/components/ProxyInstancePanel.tsx`
- 修改：`src/renderer/components/RequestPage.tsx`
- 修改：`src/renderer/components/StringToolPage.tsx`
- 修改：`test/renderer/chinese-ui.test.ts`
- 修改：`test/renderer/navigation.test.ts`

- [ ] **步骤 1：编写失败的接入断言**

断言 `App` 使用 `ToastProvider`，页面操作错误调用 `notifyError`；断言 `RuntimePanel`、地址/本地变量/登录缓存/加密、请求和字符串页面不再渲染页面内 `DismissibleError` 或 `.error-box`。保留 `JsonPreviewPage` 的内容解析错误区和已有内容操作状态提示。

- [ ] **步骤 2：运行定向测试确认失败**

运行：`npx tsx --test test/renderer/chinese-ui.test.ts test/renderer/navigation.test.ts test/renderer/toast.test.ts`

预期：新接入断言失败，现有页面仍使用 `DismissibleError`。

- [ ] **步骤 3：接入 Provider 和统一错误通知**

将 App 的 `error` 状态替换为 `notifyError`；将子页面的错误 state/render 替换为 `useToast().notifyError`；RuntimePanel 只展示状态，不再把 `status.error` 插入布局，并在状态错误变化时发送一次归一化 Toast。所有 `catch` 优先传递原始 Error 给 `toUserError`，不再把英文错误直接渲染给用户。

- [ ] **步骤 4：运行 renderer 定向测试和构建**

运行：`npx tsx --test test/renderer/*.test.ts`、`npm run build`

预期：renderer 测试和生产构建均通过。

### 任务 4：全量回归和差异检查

**文件：**
- 验证：`src/renderer/toast.ts`
- 验证：`src/renderer/components/ToastProvider.tsx`
- 验证：所有任务 3 文件和测试文件

- [ ] **步骤 1：运行全量测试**

运行：`npm test`

预期：0 failures；Windows-only 测试在当前平台按既有规则跳过。

- [ ] **步骤 2：检查空白和实现范围**

运行：`git diff --check`；确认错误视口使用 `position: fixed`、`right`、`bottom` 和 5000ms 定时器，确认 JSON 内容错误没有被误改为全局 Toast。

- [ ] **步骤 3：交付变更**

报告 Toast 入口、错误中文化规则、自动隐藏时长和测试结果；不提交或覆盖工作区中与本需求无关的既有修改。
