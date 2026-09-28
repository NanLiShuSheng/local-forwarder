# GitHub Releases 自动更新交接文档

日期：2026-09-28
状态：v0.1.1 本地候选准备中；GitHub Release 尚未推送

## 目标

为 Local Forwarder 接入 GitHub Releases 自动更新：应用检测新版本，用户手动下载，显示下载进度，下载完成后停止代理并重启安装。

GitHub 仓库已确认：`NanLiShuSheng/local-forwarder`，公开仓库，默认分支 `main`。

## 最新状态（2026-09-28）

- 当前工作树：分支 `local-forwarder`，`package.json` 已更新为 `0.1.1`。GitHub 的 `main` 指向 `0a2242d`，远端 `v0.1.0` Tag 指向 `b502073`；当前分支包含该发布提交及其后的 `8d19ef6`、`65420d2`。本地同名 `v0.1.0` Tag 却指向 `65420d2`，与 GitHub 已发布 Tag 不同。不要推送本地 `v0.1.0` Tag，也不要使用 `git push --tags`。发布改动尚未提交，当前 checkout 未配置 Git remote，尚无 `v0.1.1` Tag。
- 更新安装保护问题已修复：`install()` 在停止代理前、后都检查当前状态仍为 `downloaded`；`test/electron/update-service.test.ts` 有对应回归覆盖。
- Windows 候选包位于 [`release/v0.1.1-candidate`](../../../release/v0.1.1-candidate)：本轮重新核对安装器相对 `latest.yml` 的 SHA-512 和文件大小，并通过 Release 资产校验。
- macOS x64 候选包本轮通过 Release 资产校验；ZIP 的 SHA-512 和文件大小与 `latest-mac.yml` 一致，DMG 也通过只包含 x86_64 主程序的架构校验。本地 ARM64 runtime 下载因 GitHub 连接超时无法完成；此前使用临时 x64 runtime 生成的 arm64 ZIP 已确认架构错误，未放入候选目录。项目配置没有该临时覆盖，GitHub Actions 会按 arm64 目标下载 runtime 并执行 DMG 验证。
- Release workflow 将 macOS 资产先放入 `macos-release-assets/` 再上传，保证下载到 publish job 后的 DMG、ZIP、`.blockmap` 和 `latest-mac.yml` 都处于同一层。
- 本地 macOS 包未签名/公证。正式 Release 需要在 GitHub 仓库配置 `MACOS_CERTIFICATE_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。
- 此前全量验证为 426 项通过、1 项跳过、0 项失败；本轮未重新运行测试。此次新增的发布资产哈希和 Tag 检查已单独通过。
- `src/renderer/styles.css` 有既有未提交修改，继续保留；暂存发布改动时应显式选择文件。正式资产由 GitHub Actions 从最终 Tag 重建，候选目录只用于本地预检。

## 仍需完成

1. 配置 `origin` 后推送 `local-forwarder` 分支，并将分支现有提交和发布改动审阅、合入 `main`；不要推送本地 `v0.1.0` Tag。
2. 在 GitHub Actions Secrets 配置上面列出的 macOS 签名/公证变量。
3. 在已合入 `main` 的发布提交上创建并单独推送 `v0.1.1` Tag；Release workflow 会在 GitHub runner 上构建并验证 x64/arm64 资产。
4. 发布后用 `0.1.0` 安装包验证升级到 `0.1.1`。

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

## 关键发布约定

- 当前版本基线：`0.1.0`。
- Release Tag 必须匹配 package 版本，例如 `v0.1.1`。
- 客户端不内置 GitHub Token。
- macOS 自动更新需要 GitHub Actions Secrets：

```text
MACOS_CERTIFICATE_BASE64
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

- 普通构建不能发布；只有匹配版本 Tag 的 Release workflow 才能上传安装包和 `latest.yml`/`latest-mac.yml`。
- 不要执行 `git reset --hard`、`git checkout --` 或清理未跟踪文件。工作树中有大量用户既有修改，必须保留。

## 工作树注意事项

当前分支为 `local-forwarder`，发布实现尚未提交，checkout 和父工作树均未配置 Git remote。本地 `v0.1.0` Tag 与 GitHub 已发布 Tag 指向不同提交，禁止推送本地 `v0.1.0` Tag。保留 `src/renderer/styles.css` 的既有修改；提交时只显式暂存已审阅的发布文件，不要批量暂存或回退工作区。
