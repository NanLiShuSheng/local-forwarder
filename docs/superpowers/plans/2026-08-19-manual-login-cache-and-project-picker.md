# 手动登录缓存与项目目录选择实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让用户可以粘贴旧版 `_local` 登录缓存保存，并通过 macOS 系统目录选择框设置 H5 项目目录。

**架构：** 在 shared 层增加纯文本缓存解析函数；通过 preload 白名单 IPC 调用主进程目录选择对话框；renderer 只处理结构化结果并调用现有配置保存流程。配置仍保存到应用内部 `config.json`，不直接改写原始 `config.js`。

**技术栈：** TypeScript、React/Vite、Electron `dialog`、Node 内置测试。

---

### 任务 1：实现并测试登录缓存文本解析

**文件：**
- 创建：`src/shared/local-cache.ts`
- 创建：`test/shared/local-cache.test.ts`

- [x] **步骤 1：编写失败测试**

测试 `parseLocalCacheText` 支持空行、首个等号分割、值中的等号、重复键以后者为准，并拒绝没有等号或空键的非空行。

- [x] **步骤 2：运行测试确认失败**

运行：`node --import tsx --test test/shared/local-cache.test.ts`

预期：因 `src/shared/local-cache.ts` 和 `parseLocalCacheText` 尚不存在而失败。

- [x] **步骤 3：实现最少解析逻辑**

导出 `parseLocalCacheText(text: string): Record<string, string>`：逐行处理，跳过空行；使用首个 `=` 分割；键 `trim()` 后必须非空；值只去除首尾空白；重复键覆盖前值；格式错误抛出包含行号的中文无关错误信息即可由 UI 转换。

- [x] **步骤 4：运行测试确认通过**

运行：`node --import tsx --test test/shared/local-cache.test.ts`

预期：全部缓存解析测试通过。

- [x] **步骤 5：提交**

```bash
git add src/shared/local-cache.ts test/shared/local-cache.test.ts
git commit -m "feat: parse pasted login cache values"
```

### 任务 2：增加项目目录选择 IPC

**文件：**
- 修改：`src/shared/contracts.ts`
- 修改：`electron/preload.ts`
- 修改：`electron/main.ts`
- 修改：`test/electron/ipc-contract.test.ts`
- 修改：`test/electron/preload-contract.test.ts`

- [ ] **步骤 1：编写失败合同测试**

断言 `IPC_CHANNELS.selectProjectDirectory` 为 `config:select-project-directory`，`ForwarderApi` 暴露选择方法，并编译后的 preload 不包含 shared contracts 运行时依赖。

- [ ] **步骤 2：运行定向测试确认失败**

运行：`npm run build && node --import tsx --test test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts`

预期：新增通道和 API 合同断言失败。

- [ ] **步骤 3：实现主进程和 preload**

在 shared 合同中增加：

```ts
selectProjectDirectory(): Promise<OperationResult & { path?: string; canceled?: boolean }>;
```

在 preload 和 main 使用同名通道；主进程用 `dialog.showOpenDialog({ properties: ["openDirectory"] })`，取消返回 `{ ok: false, canceled: true }`，选择后返回 `{ ok: true, path }`。

- [ ] **步骤 4：运行定向测试确认通过**

运行：`npm run build && node --import tsx --test test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts`

预期：合同测试通过。

- [ ] **步骤 5：提交**

```bash
git add src/shared/contracts.ts electron/preload.ts electron/main.ts test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts
git commit -m "feat: expose project directory picker"
```

### 任务 3：接入中文界面

**文件：**
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/App.tsx`
- 修改：`test/renderer/chinese-ui.test.ts`

- [ ] **步骤 1：编写失败 UI 合同测试**

断言界面包含“粘贴登录缓存”“保存登录缓存”“选择项目目录”等中文文案，以及 `parseLocalCacheText` 和 `selectProjectDirectory` 的调用点。

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build && node --import tsx --test test/renderer/chinese-ui.test.ts`

预期：新增界面文案或调用点断言失败。

- [ ] **步骤 3：实现 UI**

变量页增加受控多行输入框；保存时调用解析函数，将结果与 `config.localValues` 合并后调用现有 `onChange`，成功清空输入，失败显示错误。设置页增加当前目录输入展示和系统目录选择按钮；选择成功后调用 `onChange` 保存绝对路径，取消不显示错误。

- [ ] **步骤 4：运行测试确认通过**

运行：`npm run build && node --import tsx --test test/renderer/chinese-ui.test.ts`

预期：UI 合同测试通过且 renderer 严格类型检查通过。

- [ ] **步骤 5：提交**

```bash
git add src/renderer/components/ConfigPages.tsx src/renderer/App.tsx test/renderer/chinese-ui.test.ts
git commit -m "feat: add manual cache and project directory controls"
```

### 任务 4：完整验证与交付

**文件：**
- 修改：`docs/WORK-PLAN.md`

- [ ] **步骤 1：运行完整测试**

运行：`npm test`

预期：全部测试通过，退出码为 0。

- [ ] **步骤 2：检查差异并更新工作计划**

运行：`git diff --check`；在工作计划记录手动缓存和目录选择能力。

- [ ] **步骤 3：重新生成并验证 Intel x64 DMG**

运行：`npm run package:x64`

预期：生成 `release/Local Forwarder-0.1.0.dmg`，自动 DMG 验证通过。

- [ ] **步骤 4：提交文档并确认工作区**

```bash
git add docs/WORK-PLAN.md
git commit -m "docs: record manual cache and project picker"
git status --short
```

预期：工作区无未提交源码改动；DMG 保留在 `release/`。
