# 可关闭错误提示实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让渲染层所有错误提示都能通过右侧关闭按钮手动隐藏，并在错误内容变化时重新显示。

**架构：** 新增一个只负责展示和关闭交互的 `DismissibleError` 组件。顶部全局错误、配置页面错误和运行状态错误统一使用该组件；运行状态错误由组件内部记录已关闭的错误文本，收到新文本后重新显示。

**技术栈：** React、TypeScript、现有 CSS、Node.js 内置测试。

---

### 任务 1：编写错误提示行为测试

**文件：**
- 修改：`test/renderer/chinese-ui.test.ts`
- 修改：`test/renderer/navigation.test.ts`（如需补充跨组件错误提示检查）

- [x] **步骤 1：编写失败测试**

  检查 renderer 源码中存在统一可关闭错误组件、关闭按钮无障碍标签，以及 App、RuntimePanel、ConfigPages 的所有错误入口都使用该组件。

- [x] **步骤 2：运行测试验证失败**

  运行：`node --import tsx --test test/renderer/chinese-ui.test.ts test/renderer/navigation.test.ts`

  预期：FAIL，当前仍直接渲染 `.error-box`，没有统一关闭按钮。

### 任务 2：实现统一可关闭错误提示

**文件：**
- 创建：`src/renderer/components/DismissibleError.tsx`
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/RuntimePanel.tsx`
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/styles.css`

- [x] **步骤 1：实现统一组件**

  组件接收 `message` 和 `onClose`，输出 `role="alert"` 的 `.error-box`，右侧按钮使用 `type="button"` 和 `aria-label="关闭错误提示"`。

- [x] **步骤 2：替换顶部和页面错误入口**

  App 的全局 `error` 使用 `setError("")` 关闭；地址、本地变量、登录缓存和加密错误分别使用各自 setter 清空。

- [x] **步骤 3：处理运行状态错误**

  RuntimePanel 记录已关闭的错误文本；当 `status.error` 文本变化时取消关闭状态，保证新错误仍能显示。

- [x] **步骤 4：补充关闭按钮布局样式**

  保持现有错误框视觉样式，增加内容与关闭按钮的横向布局、按钮焦点和悬停状态。

### 任务 3：验证红绿循环和回归

**文件：**
- 无新增文件

- [x] **步骤 1：运行 renderer 测试确认绿灯**

  运行：`node --import tsx --test test/renderer/chinese-ui.test.ts test/renderer/navigation.test.ts`

  预期：全部通过。

- [x] **步骤 2：运行完整测试**

  运行：`npm test`

  预期：全部测试通过，且没有 TypeScript 或 Vite 构建错误。

- [x] **步骤 3：检查差异**

  运行：`git diff --check`

  预期：无格式错误；保留工作区中原有未提交改动。
