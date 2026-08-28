# 多代理实例并行转发实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans（当前会话使用）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将单个转发服务升级为多个可独立配置、独立启停并可同时运行的代理实例，同时保留原有加密、请求、规则、缓存、变量和日志功能。

**架构：** `ForwardingService` 继续负责一个代理实例；新增 `ProxyWorkspaceStore` 持久化实例集合，新增 `ForwardingServiceManager` 管理实例选择、生命周期、端口冲突和配置写入。Electron IPC 的旧接口作用于当前选中实例，新增实例管理接口；React 概览页增加实例列表和新增/复制操作。

**技术栈：** TypeScript、Node `node:test`、Electron IPC、React、Vite。

---

### 任务 1：定义实例模型和 IPC 合约

**文件：**
- 修改：`src/shared/contracts.ts`
- 修改：`src/shared/validation.ts`
- 测试：`test/shared/proxy-instances.test.ts`
- 测试：`test/electron/ipc-contract.test.ts`

- [ ] **步骤 1：编写失败测试**

为实例摘要、工作区和新增 IPC 建立最小断言：实例包含 id/name/config；工作区必须包含实例和当前实例 ID；实例摘要能暴露端口、上游、状态和请求数；IPC 包含列表、选择、新增、复制接口。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --import tsx --test test/shared/proxy-instances.test.ts test/electron/ipc-contract.test.ts`

预期：因类型和 `IPC_CHANNELS` 尚未包含实例管理字段而失败。

- [ ] **步骤 3：实现最少合约与校验**

新增 `ProxyInstance`、`ProxyWorkspace`、`ProxyInstanceSummary` 类型，扩展 `ForwarderApi`，增加 `proxyInstances:list`、`proxyInstances:select`、`proxyInstances:create`、`proxyInstances:duplicate` 四个频道，并为工作区实例配置复用 `isValidAppConfig` 校验。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --import tsx --test test/shared/proxy-instances.test.ts test/electron/ipc-contract.test.ts`

预期：相关测试全部通过。

- [ ] **步骤 5：提交任务变更**

运行：`git add src/shared/contracts.ts src/shared/validation.ts test/shared/proxy-instances.test.ts test/electron/ipc-contract.test.ts && git commit -m "feat: define proxy instance contracts"`

### 任务 2：实现工作区持久化和旧配置迁移

**文件：**
- 创建：`src/core/runtime/proxy-workspace-store.ts`
- 修改：`src/core/config/model.ts`
- 测试：`test/core/runtime/proxy-workspace-store.test.ts`

- [ ] **步骤 1：编写失败测试**

覆盖三种行为：首次没有工作区时从旧 `config.json` fallback 创建“默认代理”；保存后重新加载保留多个实例和当前实例；非法工作区不会被接受，且原文件保持可恢复。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --import tsx --test test/core/runtime/proxy-workspace-store.test.ts`

预期：模块不存在或导出方法不存在导致失败。

- [ ] **步骤 3：实现最少存储逻辑**

实现 JSON 工作区格式 `{ version: 1, selectedInstanceId, instances }`，使用临时文件加 rename 原子保存；加载时先读取工作区，工作区不存在时调用 fallback 加载旧 `AppConfig`，迁移为 id 为 `default`、名称为“默认代理”的实例。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --import tsx --test test/core/runtime/proxy-workspace-store.test.ts`

预期：迁移、往返保存和非法数据测试全部通过。

- [ ] **步骤 5：提交任务变更**

运行：`git add src/core/runtime/proxy-workspace-store.ts src/core/config/model.ts test/core/runtime/proxy-workspace-store.test.ts && git commit -m "feat: persist proxy instance workspace"`

### 任务 3：实现多实例服务管理器

**文件：**
- 创建：`src/core/runtime/forwarding-service-manager.ts`
- 修改：`src/core/runtime/forwarding-service.ts`
- 测试：`test/core/runtime/forwarding-service-manager.test.ts`

- [ ] **步骤 1：编写失败测试**

覆盖：两个实例可以分别启动并保持 running；当前实例切换后配置、状态和日志指向新实例；相同 bindHost/port 的运行实例被拒绝且已运行实例保持 running；复制实例得到新 ID、名称和未占用端口；单实例停止不影响另一个实例。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --import tsx --test test/core/runtime/forwarding-service-manager.test.ts`

预期：管理器模块不存在而失败。

- [ ] **步骤 3：实现最少管理器逻辑**

将 `ForwardingService` 的配置存储依赖收窄为只包含 `save(config)` 的接口；管理器按实例创建服务，提供 `list`、`select`、`create`、`duplicate`、`getConfig`、`saveConfig`、`start`、`stop`、`status`、`logs`、`mergeLocalValues` 和 `stopAll`；启动前检查其他 running/starting 实例的绑定地址和端口。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --import tsx --test test/core/runtime/forwarding-service-manager.test.ts test/core/runtime/forwarding-service.test.ts`

预期：管理器新增测试和既有单实例测试全部通过。

- [ ] **步骤 5：提交任务变更**

运行：`git add src/core/runtime/forwarding-service-manager.ts src/core/runtime/forwarding-service.ts test/core/runtime/forwarding-service-manager.test.ts && git commit -m "feat: manage multiple forwarding services"`

### 任务 4：接入 Electron 主进程和 Preload

**文件：**
- 修改：`electron/main.ts`
- 修改：`electron/preload.ts`
- 测试：`test/electron/proxy-instance-ipc.test.ts`
- 修改：`test/electron/preload-contract.test.ts`

- [ ] **步骤 1：编写失败测试**

断言主进程注册实例管理频道、Preload 暴露对应 API；实例切换后 `getConfig`、`status`、`logs` 和 `sendRequest` 使用当前实例；退出时调用 `stopAll`。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --import tsx --test test/electron/proxy-instance-ipc.test.ts test/electron/preload-contract.test.ts`

预期：实例频道和 API 尚未出现而失败。

- [ ] **步骤 3：实现 IPC 接线**

主进程用 `ProxyWorkspaceStore` 加载并迁移工作区，创建 `ForwardingServiceManager`；旧运行/配置/请求/日志 IPC 改为调用管理器；新增实例列表、选择、新增、复制 handler；旧配置导入替换当前实例，导出导出当前实例；退出流程改为 `manager.stopAll()`。Preload 继续只暴露类型化 IPC，不引入 Node 依赖。

- [ ] **步骤 4：运行测试确认通过**

运行：`npm run build:electron && node --import tsx --test test/electron/proxy-instance-ipc.test.ts test/electron/preload-contract.test.ts test/electron/ipc-contract.test.ts`

预期：Electron 编译和相关合约测试全部通过。

- [ ] **步骤 5：提交任务变更**

运行：`git add electron/main.ts electron/preload.ts test/electron/proxy-instance-ipc.test.ts test/electron/preload-contract.test.ts && git commit -m "feat: expose proxy instance IPC"`

### 任务 5：实现概览页实例列表和操作

**文件：**
- 创建：`src/renderer/components/ProxyInstancePanel.tsx`
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/RuntimePanel.tsx`
- 修改：`src/renderer/styles.css`
- 测试：`test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 1：编写失败测试**

读取 renderer 源码断言实例列表、端口/上游信息、“新增代理”“复制当前代理”、切换 API 和单实例“启动代理/停止代理”存在，同时原有“请求”和“加密”导航仍存在。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --import tsx --test test/renderer/proxy-instance-panel.test.ts`

预期：新组件、实例 API 和按钮文案尚未出现而失败。

- [ ] **步骤 3：实现最少 UI**

在概览页加入实例列表组件；App 维护实例摘要、当前实例和刷新逻辑；切换/新增/复制后刷新当前配置、状态和日志；RuntimePanel 使用“启动代理”“停止代理”；沿用现有配置页面，使请求、日志和规则随着当前实例切换，加密页面仍使用全局回调。

- [ ] **步骤 4：运行测试确认通过**

运行：`node --import tsx --test test/renderer/proxy-instance-panel.test.ts test/renderer/navigation.test.ts test/renderer/encryption-panel.test.ts test/renderer/request-panel.test.ts`

预期：实例 UI 测试和原有页面回归测试全部通过。

- [ ] **步骤 5：提交任务变更**

运行：`git add src/renderer/App.tsx src/renderer/components/ProxyInstancePanel.tsx src/renderer/components/RuntimePanel.tsx src/renderer/styles.css test/renderer/proxy-instance-panel.test.ts && git commit -m "feat: add proxy instance management UI"`

### 任务 6：全量验证和安装

**文件：**
- 修改：`docs/WORK-PLAN.md`

- [ ] **步骤 1：运行格式和类型检查**

运行：`git diff --check && npm run build`

预期：退出码为 0。

- [ ] **步骤 2：运行完整测试**

运行：`npm test`

预期：构建成功，所有测试通过且失败数为 0。

- [ ] **步骤 3：构建并验证安装包**

运行：`npm run package:x64`

预期：生成并验证 `release/Local Forwarder-0.1.0.dmg`。

- [ ] **步骤 4：安装应用**

运行：使用生成的 DMG 安装到 `/Applications/Local Forwarder.app`；如果当前 Electron GUI 环境仍因 `SIGABRT` 无法启动，则保留已完成的构建和安装包验证，并明确记录 GUI 环境阻塞。

- [ ] **步骤 5：更新工作计划并提交**

运行：`git add docs/WORK-PLAN.md && git commit -m "docs: record multi proxy implementation verification"`

