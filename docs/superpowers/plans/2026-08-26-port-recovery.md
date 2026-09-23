# 808x 端口自动恢复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans（推荐内联执行）逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 服务启动遇到 8080–8089 端口占用时，自动释放占用进程并重试启动。

**架构：** 在 `src/core/runtime/port-recovery.ts` 中隔离 macOS `lsof`、信号发送和端口释放轮询。`ForwardingService` 只在 HTTP 启动返回 `EADDRINUSE` 且端口属于 808x 时调用一次恢复，然后重试监听；其他错误和端口保持原行为。

**技术栈：** Node.js `child_process.execFile`、`process.kill`、TypeScript、Node test runner、tsx。

---

### 任务 1：端口恢复模块的失败测试

**文件：**
- 创建：`test/core/runtime/port-recovery.test.ts`
- 参考：`src/core/runtime/forwarding-service.ts`

- [ ] **步骤 1：编写测试**

测试注入 `listeningProcessIds`、`sendSignal` 和 `sleep`，验证 `8080` 与 `8089` 可恢复，`8079` 与 `8090` 不执行恢复；第一轮发送 `SIGTERM` 后返回空 PID 时不发送 `SIGKILL`，PID 持续存在时发送 `SIGKILL`。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/runtime/port-recovery.test.ts`

预期：因 `src/core/runtime/port-recovery.ts` 尚不存在而失败。

### 任务 2：实现端口恢复模块

**文件：**
- 创建：`src/core/runtime/port-recovery.ts`
- 测试：`test/core/runtime/port-recovery.test.ts`

- [ ] **步骤 1：实现范围判断和依赖接口**

导出 `isAutoRecoverablePort`、`recoverOccupiedPort` 以及可注入依赖类型；端口范围固定为 8080–8089。

- [ ] **步骤 2：实现 macOS 监听 PID 查询**

使用 `execFile("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"])` 解析数字 PID；命令返回空结果时视为没有监听进程，命令不可执行时抛出错误。

- [ ] **步骤 3：实现 SIGTERM、轮询和 SIGKILL 兜底**

先对非当前进程发送 `SIGTERM`，最多等待 1000ms；仍有 PID 时发送 `SIGKILL`，再等待 1000ms；最终仍占用则抛出恢复失败错误。

- [ ] **步骤 4：运行测试确认通过**

运行：`npx tsx --test test/core/runtime/port-recovery.test.ts`

预期：全部端口恢复测试通过。

### 任务 3：接入服务启动重试

**文件：**
- 修改：`src/core/runtime/forwarding-service.ts`
- 修改：`test/core/runtime/forwarding-service.test.ts`

- [ ] **步骤 1：编写 EADDRINUSE 恢复测试**

注入一个首次抛出 `{ code: "EADDRINUSE" }`、第二次返回监听地址的 HTTP 工厂，注入端口恢复函数，断言 8080 端口只恢复一次并最终进入 `running`；再断言 8090 不调用恢复函数并保留启动失败。

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/runtime/forwarding-service.test.ts`

预期：恢复注入尚未接入，8080 场景启动失败。

- [ ] **步骤 3：接入启动恢复并限制一次重试**

在 HTTP `start()` 抛出 `EADDRINUSE` 时调用 `recoverOccupiedPort(this.config.server.port)`，成功后再次调用同一个 HTTP 实例的 `start()`；恢复和第二次启动失败均进入原有清理流程。

- [ ] **步骤 4：运行定向测试确认通过**

运行：`npx tsx --test test/core/runtime/port-recovery.test.ts test/core/runtime/forwarding-service.test.ts`

预期：全部通过。

### 任务 4：完整验证与安装

**文件：**
- 验证：`src/core/runtime/port-recovery.ts`
- 验证：`src/core/runtime/forwarding-service.ts`
- 验证：`test/core/runtime/port-recovery.test.ts`
- 验证：`test/core/runtime/forwarding-service.test.ts`

- [ ] **步骤 1：运行全量测试和差异检查**

运行：`npm test`、`git diff --check`

预期：构建成功、全部测试通过、无空白错误。

- [ ] **步骤 2：生成并校验 x64 DMG**

运行：`CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:x64`

预期：生成并通过 `release/Local Forwarder-0.1.0.dmg` 校验。

- [ ] **步骤 3：安装应用**

将已校验 DMG 中的 `Local Forwarder.app` 安装到用户 `~/Applications`（若不存在则创建），不覆盖系统 `/Applications` 中的其他应用；安装前退出同名运行实例。
