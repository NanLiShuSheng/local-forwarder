# GitHub Releases 自动更新交接文档

日期：2026-11-10
状态：Windows x64 自动更新代码已接入；`0.1.2` 发布准备完成，GitHub Release 尚未创建

## 目标

为 Local Forwarder 接入 GitHub Releases 自动更新：应用检测新版本，用户手动下载，显示下载进度，下载完成后停止代理并重启安装。

GitHub 仓库已确认：`NanLiShuSheng/local-forwarder`，公开仓库，默认分支 `main`。

## 最新状态（2026-11-10）

- 自动更新发布只支持 Windows x64。Release workflow 只构建 NSIS 安装器，并上传 `.exe`、`.blockmap` 和 `latest.yml`；macOS 本地打包配置保留，不参与自动更新发布。
- `package.json` 和 `package-lock.json` 已升级到 `0.1.2`。GitHub Releases 仍为空；下一次发布必须使用匹配的 `v0.1.2` Tag，不能复用 `v0.1.1` 或 `v0.1.0`。
- Windows CI 的 `npm test` 失败已定位为测试契约漂移：`3931902` 修改了 JSON 预览搜索展开、侧栏背景/标题占位和代理概览锁定方式，但相关 renderer 测试未同步；当前已更新这些测试契约。
- 同时把 legacy config 子进程测试超时从 4 秒提高到 15 秒，并把 Windows 端口恢复测试改为在 `8080–8089` 中动态选择空闲端口，避免 Windows runner 启动慢或固定端口被占用造成 CI 抖动。
- `electron-builder.yml` 已显式声明 NSIS `oneClick: true`、`perMachine: false`，保持 per-user 安装，自动更新不应触发 UAC。
- Release workflow 已预留 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` Secrets 注入；未配置证书时安装包为未签名状态。
- 本地 macOS 全量 `npm test` 已通过：455 个测试，454 通过、1 个 Windows-only 跳过、0 失败；`GITHUB_REF_NAME=v0.1.2 npm run verify:release:tag` 通过。
- 本地产物已生成并通过 `verify:win`、`verify:release:win`：`dist/Local-Forwarder-Setup-0.1.2.exe`（228,413,129 字节）、`.exe.blockmap`、`latest.yml`；`latest.yml` 的 SHA-512 与实际安装器一致。
- Windows 升级基线可使用 `release/v0.1.1-candidate/Local-Forwarder-Setup-0.1.1.exe`；已确认其 `resources/app-update.yml` 指向同一 GitHub Release 仓库。
- Windows CI 仍需在提交后重新运行确认；真实 `0.1.1 -> 0.1.2` 安装升级和代码签名仍需在 Windows 环境完成。

## 仍需完成

1. 提交发布改动，创建并推送 `v0.1.2` Tag，确认 Windows CI 和 Release workflow 均通过。
2. 确认 GitHub Release 含 `Local-Forwarder-Setup-0.1.2.exe`、对应 `.blockmap` 和 `latest.yml`，且不是 Draft。
3. 在 Windows 安装含更新器的 `0.1.1` 基线，完成检查、下载、安装、重启和 `0.1.1 -> 0.1.2` 版本变化验收。
4. 验证升级前代理全部停止、配置/缓存/登录数据保留；如安装后未自动拉起应用，再检查 `electron-updater` 的 `autoRunAppAfterInstall` 和安装参数。
5. 为正式分发准备 Windows 代码签名证书并配置 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` Secrets；未签名版本可能触发 SmartScreen 或企业安全软件拦截。

## 历史记录（截至 2026-09-21）

### 设计与计划

- 设计规格：[`2026-09-21-github-releases-auto-update-design.md`](../specs/2026-09-21-github-releases-auto-update-design.md)
- 实现计划：[`2026-09-21-github-releases-auto-update.md`](../plans/2026-09-21-github-releases-auto-update.md)
- 设计提交：`51a40a8`
- 计划提交：`04d6171`

### 任务 1：发布配置

已完成并通过两阶段审查：

- `d3f3241`：加入 `electron-updater`、`@electron/notarize`、GitHub provider、macOS DMG/ZIP 和 Release 脚本。
- `e59ee76`：补齐配置契约测试，并保留用户已有的 Windows 平台保护修改。
- `96b4fef`：普通 `package:x64` 和 `package:win:x64` 增加 `--publish never`，避免普通 CI 隐式发布。

验证结果：任务 1 定向测试 5/5 通过；依赖锁文件、YAML 配置和 diff 检查通过。

当前发布基础配置包括：

- GitHub owner：`NanLiShuSheng`
- GitHub repo：`local-forwarder`
- macOS target：`dmg + zip`
- Windows target：`nsis`
- 普通构建：显式 `--publish never`
- Release 构建：后续由 GitHub Actions 发布 job 上传资产

### 任务 2：主进程更新服务

已完成基础实现并提交：

- `171b9be feat: add controlled update service`
- 新增 [`electron/update-service.ts`](../../../electron/update-service.ts)
- 新增 [`test/electron/update-service.test.ts`](../../../test/electron/update-service.test.ts)
- `src/shared/contracts.ts` 新增共享更新状态类型；既有 `requestPath` 修改未混入提交

已实现：

- `UpdateStateKind`：`idle/checking/available/downloading/downloaded/not-available/error`
- `UpdateAdapter` 注入接口及真实 `electron-updater` adapter
- `autoDownload = false`
- `autoInstallOnAppQuit = false`
- 更新事件映射、下载进度限制、中文错误 fallback
- 检查/下载 Promise 去重
- 10 秒一次的后台检查计时器
- adapter listener 和计时器清理
- 安装前调用 `stopAll()`

验证结果：专项测试 11/11 通过；当时运行的全量测试为 395 通过、1 个 Windows-only 跳过、0 失败；构建和 diff 检查通过。

## 当时发现的问题（当前代码已修复）

2026-09-21 交接时发现 `install()` 依赖旧的 `downloadReady` 标记。当前实现已改为检查 `state.state === "downloaded"`，并在停止代理后再次确认状态；回归测试位于 `test/electron/update-service.test.ts`。

## 原始实现任务顺序（截至 2026-09-21）

按实现计划继续，不要跳过审查关卡：

1. 修复并完成任务 2。
2. 任务 3：把更新服务接入 `src/shared/contracts.ts`、`electron/main.ts`、`electron/preload.ts` 和 IPC 契约测试。
3. 任务 4：实现右下角持久更新卡片、外观页版本入口和浅色/深色样式。
4. 任务 5：实现 Release Tag 校验、资产校验、macOS 签名环境校验和 notarize hook。
5. 任务 6：创建 `.github/workflows/release.yml`，构建 Windows/macOS 并上传 Release 资产。
6. 任务 7：运行全量验证、平台打包和两版本升级验收。
7. 任务 8：最终安全检查、代码审查和发布交接。

## Windows 发布约定

- 当前版本为 `0.1.2`；下一版必须使用更高版本，例如 `0.1.3`。
- Release Tag 必须与 `package.json.version` 匹配，例如 `0.1.2` 对应 `v0.1.2`。
- NSIS 固定使用 one-click、per-user 安装；若改为 per-machine，需要重新验证 UAC 和更新提权流程。
- 客户端不内置 GitHub Token。
- Windows Release 上传 NSIS 安装器、`.blockmap` 和 `latest.yml`；Windows 代码签名可选。
- Windows 代码签名通过 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 注入；证书未配置时不要宣称安装包已签名。
- 普通构建不能发布；只有匹配版本 Tag 的 Release workflow 才会创建 GitHub Release。
- 不要执行 `git reset --hard`、`git checkout --` 或清理未跟踪文件；保留工作树中的用户修改。

## 工作树注意事项

当前分支为 `local-forwarder`。工作开始前，分支与 `origin/local-forwarder` 均指向 `3931902`。本地 `v0.1.0` Tag 与远端 Tag 指向不同提交，不要推送本地 `v0.1.0` Tag，也不要使用 `git push --tags`。
