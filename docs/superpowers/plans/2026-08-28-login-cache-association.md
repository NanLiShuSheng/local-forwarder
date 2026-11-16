# 登录缓存关联优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans（推荐）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将本地变量改为工作区共享、登录缓存改为代理实例独立存储，并让捕获值实时显示在概览和登录缓存输入框。

**架构：** `ProxyWorkspace` 保存 `sharedValues` 和实例 `loginCache`。`ForwardingServiceManager` 负责合并变量、迁移和跨实例同步；单个 `ForwardingService` 只负责把 HTTP 捕获事件回调给 manager。Electron IPC 暴露当前配置和实例摘要，React 页面根据配置渲染实际缓存文本。

**技术栈：** TypeScript、Node.js `node:test`、Electron IPC、React/Vite。

---

### 任务 1：扩展工作区数据契约与迁移

**文件：**
- 修改：`src/shared/contracts.ts`
- 修改：`src/shared/validation.ts`
- 修改：`src/core/config/model.ts`
- 修改：`src/core/runtime/proxy-workspace-store.ts`
- 测试：`test/shared/proxy-instances.test.ts`
- 测试：`test/core/runtime/proxy-workspace-store.test.ts`

- [ ] 编写测试：合法工作区必须包含 `sharedValues` 和实例 `loginCache`；旧工作区加载后把旧 `config.localValues` 迁移到 `loginCache` 并清空运行时旧字段。
- [ ] 运行 `npx tsx --test test/shared/proxy-instances.test.ts test/core/runtime/proxy-workspace-store.test.ts`，确认在新字段尚未实现时失败。
- [ ] 增加契约、默认值、校验和兼容迁移实现；保证迁移后的 AppConfig 仍通过现有配置校验。
- [ ] 运行同一命令确认通过，并检查旧版配置测试无回归。

### 任务 2：实现共享变量与实例登录缓存运行时

**文件：**
- 修改：`src/core/runtime/forwarding-service.ts`
- 修改：`src/core/runtime/forwarding-service-manager.ts`
- 修改：`src/core/http/http-proxy.ts`
- 测试：`test/core/runtime/forwarding-service-manager.test.ts`
- 测试：`test/core/runtime/forwarding-service.test.ts`
- 测试：`test/core/http/http-proxy.test.ts`

- [ ] 编写测试：共享变量变更同步到两个实例；登录缓存只更新选中实例；复制实例不复制缓存；HTTP 捕获事件回写登录缓存。
- [ ] 运行相关测试确认失败。
- [ ] 为服务管理器增加共享变量、登录缓存读取/保存/合并接口；运行实例使用合并变量；为 HTTP 回调增加登录值专用回调。
- [ ] 运行相关测试确认通过，再做最小重构保持旧测试替身兼容。

### 任务 3：接通 Electron IPC 和手动请求捕获

**文件：**
- 修改：`src/shared/contracts.ts`
- 修改：`electron/main.ts`
- 修改：`electron/preload.ts`
- 测试：`test/electron/ipc-contract.test.ts`
- 测试：`test/electron/preload-contract.test.ts`

- [ ] 编写测试：请求登录响应写入当前实例缓存；获取配置返回当前实例缓存和共享变量；IPC API 名称和实现保持一致。
- [ ] 运行相关测试确认失败。
- [ ] 把手动请求的 `mergeLocalValues` 改为当前实例登录缓存合并，并让配置读取返回适合页面编辑的字段。
- [ ] 运行相关测试确认通过。

### 任务 4：更新概览与缓存页面

**文件：**
- 修改：`src/shared/contracts.ts`
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/components/ProxyInstancePanel.tsx`
- 修改：`src/renderer/styles.css`
- 测试：`test/renderer/proxy-instance-panel.test.ts`
- 测试：`test/renderer/chinese-ui.test.ts`

- [ ] 编写测试：概览渲染缓存数量；登录缓存输入框以实际缓存值初始化，并在配置刷新后更新。
- [ ] 运行相关测试确认失败。
- [ ] 将本地变量绑定共享值，将登录缓存绑定当前实例值，增加格式化和 `useEffect` 同步；在概览卡片与详情展示缓存状态。
- [ ] 运行相关测试确认通过。

### 任务 5：全量验证、打包与安装

**文件：**
- 修改：仅保留前述实现文件和对应测试文件。

- [ ] 运行 `npm test`，确认全量测试通过。
- [ ] 运行 `npm run package:x64`，确认构建、DMG 生成和包校验通过。
- [ ] 将新 DMG 安装到 `/Applications/Local Forwarder.app`，验证安装产物路径和版本。
