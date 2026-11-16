# 加密栏目实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Electron 本地转发工具中集成参考项目的 H5 资源加密能力，并生成包含编码器的 Intel x64 DMG。

**架构：** 新增独立的 `src/core/encryption/encryptor.ts` 负责纯文件处理和编码器调用；Electron 主进程负责 IPC、目录选择、资源路径和错误边界；渲染进程通过 preload API 提供“加密”栏目。输出目录必须在源目录外部。

**技术栈：** TypeScript、Node `fs/promises`、Electron IPC/dialog、React、Node test runner、electron-builder extraResources。

---

### 任务 1：核心加密模块

**文件：**
- 创建：`src/core/encryption/encryptor.ts`
- 创建：`test/core/encryption/encryptor.test.ts`

- [ ] **步骤 1：编写失败测试**

覆盖以下行为：递归处理普通文件；跳过隐藏项、`node_modules`、`dist`、`.map`；按相对路径输出 `.d`；调用可执行测试编码器并清理临时目录；第二次执行仍全量处理；拒绝不存在源目录、编码器不可用、源目录等于输出目录和输出目录位于源目录内。

- [ ] **步骤 2：运行测试确认失败**

运行 `node --import tsx --test test/core/encryption/encryptor.test.ts`，预期因 `src/core/encryption/encryptor.ts` 不存在而失败。

- [ ] **步骤 3：实现最小核心逻辑**

导出 `collectFiles(rootDir)`、`runEncoder(options)`、`encryptDirectory(options)`。使用 `mkdtemp` 创建每文件临时目录，`execFile(encoderPath, [tempInputPath])` 调用编码器，验证 `${tempInputPath}.d` 存在后复制到输出路径；使用 `realpath`/`resolve` 进行目录关系校验，并写入 `.encrypt-cache.json`。

- [ ] **步骤 4：运行核心测试确认通过**

运行同一测试命令，预期全部核心测试通过。

- [ ] **步骤 5：提交任务变更**

运行 `git add src/core/encryption/encryptor.ts test/core/encryption/encryptor.test.ts && git commit -m "feat: add directory encryption core"`。

### 任务 2：Electron IPC 与应用资源

**文件：**
- 修改：`src/shared/contracts.ts`
- 修改：`electron/preload.ts`
- 修改：`electron/main.ts`
- 修改：`electron/paths.ts`
- 修改：`electron-builder.yml`
- 修改：`scripts/verify-dmg.mjs`
- 创建：`resources/protocol/encode/h5encode-mac-amd64`
- 创建：`test/electron/encryption-contract.test.ts`

- [ ] **步骤 1：编写失败合同测试**

断言 `IPC_CHANNELS`、`ForwarderApi`、preload 白名单包含目录选择和加密调用；断言打包校验要求编码器资源存在。

- [ ] **步骤 2：运行测试确认失败**

运行 `node --import tsx --test test/electron/encryption-contract.test.ts`，预期新 channel/API/资源断言失败。

- [ ] **步骤 3：接入 IPC 和资源路径**

新增 `encryption:select-directory` 与 `encryption:run`，目录选择使用 `showOpenDialog({ properties: ["openDirectory", "createDirectory"] })`；加密 handler 调用核心模块，返回 `{ ok, totalFiles, files, logs, error? }`。开发环境和打包环境分别解析资源目录，不使用开发机绝对路径。复制参考编码器并保留可执行权限。

- [ ] **步骤 4：运行合同测试确认通过**

运行合同测试和 `npm run build:electron`，预期通过且 preload 编译不引入共享合同运行时依赖。

- [ ] **步骤 5：提交任务变更**

运行 `git add src/shared/contracts.ts electron/preload.ts electron/main.ts electron/paths.ts electron-builder.yml scripts/verify-dmg.mjs resources/protocol/encode/h5encode-mac-amd64 test/electron/encryption-contract.test.ts && git commit -m "feat: expose encryption through electron IPC"`。

### 任务 3：渲染端加密栏目

**文件：**
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/styles.css`
- 修改：`test/renderer/chinese-ui.test.ts`
- 创建：`test/renderer/encryption-panel.test.ts`

- [ ] **步骤 1：编写失败渲染测试**

断言页面导航包含“加密”，页面包含两个目录字段、两个选择按钮、开始按钮、状态和结果文案，并且执行期间按钮状态可被禁用。

- [ ] **步骤 2：运行测试确认失败**

运行 `node --import tsx --test test/renderer/encryption-panel.test.ts`，预期因缺少栏目和 API 调用而失败。

- [ ] **步骤 3：实现页面和交互**

在 `ConfigPages` 增加加密页面状态，调用 `selectEncryptionDirectory("input"|"output")` 和 `encryptDirectory(inputDir, outputDir)`；取消选择保持原路径；执行前检查两个目录已选，运行期间禁用按钮，成功展示处理数量与日志，失败展示错误。

- [ ] **步骤 4：运行渲染测试确认通过**

运行渲染测试和 `npm run build`，预期类型检查、Vite 构建及新测试通过。

- [ ] **步骤 5：提交任务变更**

运行 `git add src/renderer/App.tsx src/renderer/components/ConfigPages.tsx src/renderer/styles.css test/renderer/chinese-ui.test.ts test/renderer/encryption-panel.test.ts && git commit -m "feat: add encryption panel"`。

### 任务 4：完整验证与 DMG

**文件：**
- 修改：如验证发现问题，仅修改对应实现/测试文件

- [ ] **步骤 1：运行完整测试**

运行 `npm test`，预期输出 `tests 0 fail`，并确认现有 133 个测试及新增测试全部通过。

- [ ] **步骤 2：构建 Intel x64 DMG**

运行 `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:x64`，预期生成 `release/Local Forwarder-0.1.0.dmg`。

- [ ] **步骤 3：验证 DMG 内容**

运行 `npm run verify:package`，预期挂载校验通过，并能找到 `Contents/Resources/protocol/encode/h5encode-mac-amd64`。

- [ ] **步骤 4：执行编码器资源冒烟检查**

在临时源/目标目录中用打包前资源运行核心测试编码流程，确认输出 `.d` 文件和临时目录清理结果。
