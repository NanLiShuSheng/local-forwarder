# 目录 URL 输入实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让加密前目录、加密后目录和项目目录支持粘贴本地 `file://` URL 或路径，同时保留系统目录选择器。

**架构：** 共享层负责纯路径解析；主进程通过受信任 IPC 保存加密目录偏好；项目目录继续通过现有配置保存接口；Renderer 的三个输入框在失焦或 Enter 时提交规范化路径。

**技术栈：** Electron IPC、React、TypeScript、Node `node:test`。

---

## 文件结构

- 创建：`src/shared/directory-path.ts` — 目录 URL/路径解析纯函数。
- 修改：`src/shared/contracts.ts` — 加密偏好保存 API 和 IPC 通道。
- 修改：`electron/preload.ts` — 暴露保存加密偏好的白名单方法。
- 修改：`electron/main.ts` — 校验参数并保存加密偏好。
- 修改：`src/renderer/App.tsx` — 处理手动输入的项目目录和加密目录保存。
- 修改：`src/renderer/components/ConfigPages.tsx` — 三个目录输入框改为可编辑并绑定提交事件。
- 创建：`test/shared/directory-path.test.ts` — 解析行为测试。
- 修改：`test/core/encryption/preferences.test.ts` — 偏好 patch 保存回归测试。
- 修改：`test/electron/ipc-contract.test.ts`、`test/electron/preload-contract.test.ts` — IPC/API 合同测试。
- 修改：`test/renderer/encryption-panel.test.ts`、`test/renderer/chinese-ui.test.ts` — UI 合同测试。

## 任务 1：共享目录解析和偏好保存

**文件：**

- 创建：`src/shared/directory-path.ts`
- 创建：`test/shared/directory-path.test.ts`
- 修改：`test/core/encryption/preferences.test.ts`

- [ ] **步骤 1：编写失败测试**：断言 `file:///Users/test/My%20Project` 转为 `/Users/test/My Project`，普通绝对路径保留，远程 URL、相对路径和空值抛出中文错误；断言偏好 patch 只修改指定目录。
- [ ] **步骤 2：运行测试确认失败**：运行 `node --import tsx --test test/shared/directory-path.test.ts test/core/encryption/preferences.test.ts`，预期新解析模块缺失或新行为失败。
- [ ] **步骤 3：实现最少代码**：实现 `parseDirectoryInput(value)`，仅接受绝对本地路径和 `file:` URL；复用现有 `saveEncryptionPreferences` patch 语义。
- [ ] **步骤 4：运行测试确认通过**：重复运行上述命令，预期全部 PASS。

## 任务 2：IPC 合同和主进程保存接口

**文件：**

- 修改：`src/shared/contracts.ts`
- 修改：`electron/preload.ts`
- 修改：`electron/main.ts`
- 修改：`test/electron/ipc-contract.test.ts`
- 修改：`test/electron/preload-contract.test.ts`

- [ ] **步骤 1：编写失败测试**：新增 `saveEncryptionPreferences` 通道、Forwarder API 方法和主进程 handler 的合同断言。
- [ ] **步骤 2：运行测试确认失败**：运行 `node --import tsx --test test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts`，预期缺少新通道或 API。
- [ ] **步骤 3：实现最少代码**：新增 `encryption:save-preferences`，主进程校验 `inputDir`/`outputDir` 为字符串后调用 `saveEncryptionPreferences`，preload 只传结构化 patch。
- [ ] **步骤 4：运行测试确认通过**：重复运行合同测试，预期全部 PASS。

## 任务 3：Renderer 三个目录输入框

**文件：**

- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`test/renderer/encryption-panel.test.ts`
- 修改：`test/renderer/chinese-ui.test.ts`

- [ ] **步骤 1：编写失败测试**：断言加密两个输入框不再 `readOnly`、设置项目目录输入框不再 `readOnly`，并存在 Enter/失焦处理和保存偏好 API 调用。
- [ ] **步骤 2：运行测试确认失败**：运行 `node --import tsx --test test/renderer/encryption-panel.test.ts test/renderer/chinese-ui.test.ts`，预期只读或保存合同断言失败。
- [ ] **步骤 3：实现最少代码**：增加统一提交函数，解析输入、调用对应保存回调；有效值同步状态，无效值显示错误并恢复原值；选择按钮继续复用现有 IPC。
- [ ] **步骤 4：运行测试确认通过**：重复运行 Renderer 合同测试，预期全部 PASS。

## 任务 4：完整验证和安装

- [ ] **步骤 1：运行完整测试**：`npm test`，预期退出码 0。
- [ ] **步骤 2：检查构建和差异**：运行 `npm run build`、`git diff --check`，预期构建成功且无空白错误。
- [ ] **步骤 3：生成安装包**：运行 `npm run package:x64`，预期生成并通过项目已有 DMG 校验。
- [ ] **步骤 4：安装包**：打开生成的 macOS 安装包或执行项目提供的安装脚本，将应用安装到可运行位置，并用 smoke 校验确认能启动。

