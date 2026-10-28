# GitHub Releases 自动更新交接文档

日期：2026-10-26
状态：自动更新发布范围限定为 Windows x64；GitHub Release 尚未发布

## 目标

为 Local Forwarder 接入 GitHub Releases 自动更新：应用检测新版本，用户手动下载，显示下载进度，下载完成后停止代理并重启安装。

GitHub 仓库已确认：`NanLiShuSheng/local-forwarder`，公开仓库，默认分支 `main`。

## 最新状态（2026-10-26）

- 自动更新发布只支持 Windows x64。Release workflow 只构建 NSIS 安装器，并上传 `.exe`、`.blockmap` 和 `latest.yml`；macOS 本地打包配置保留，不参与自动更新发布。
- `package.json` 当前版本为 `0.1.1`。GitHub 远端目前只有 `v0.1.0` Tag，Release 列表为空；客户端暂时没有更新元数据可查。要升级 `0.1.1` 安装包，下一次发布版本必须高于 `0.1.1`，例如 `0.1.2`。
- 最新 Windows CI 在 `npm test` 步骤失败：[Actions run](https://github.com/NanLiShuSheng/local-forwarder/actions/runs/40280186156)。公开 API 不允许读取详细日志，需要仓库管理员在 Actions 页面查看失败用例。
- Windows Release 不需要 Apple 签名/公证 Secrets。Windows 代码签名可选，主要用于减少 SmartScreen 提示。
- 自动更新服务和界面已经接入；尚未通过两版 Windows 安装包完成真实升级验收。

## 仍需完成

1. 查看并修复 Windows CI 的测试失败，确保 Release 工作流中的 `npm test` 通过。
2. 准备高于 `0.1.1` 的版本号，更新 `package.json` 和 `package-lock.json`，并创建版本匹配的 `v` Tag。
3. 确认 GitHub Release 含 NSIS 安装器、对应 `.blockmap` 和 `latest.yml`。
4. 从 Windows NSIS 安装版检查、下载并升级到新版本，完成端到端验收。

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

- 当前版本为 `0.1.1`；下一次更新必须使用更高版本，例如 `0.1.2`。
- Release Tag 必须与 `package.json.version` 匹配，例如 `0.1.2` 对应 `v0.1.2`。
- 客户端不内置 GitHub Token。
- Windows Release 上传 NSIS 安装器、`.blockmap` 和 `latest.yml`；Windows 代码签名可选。
- 普通构建不能发布；只有匹配版本 Tag 的 Release workflow 才会创建 GitHub Release。
- 不要执行 `git reset --hard`、`git checkout --` 或清理未跟踪文件；保留工作树中的用户修改。

## 工作树注意事项

当前分支为 `local-forwarder`。工作开始前，分支与 `origin/local-forwarder` 均指向 `3931902`。本地 `v0.1.0` Tag 与远端 Tag 指向不同提交，不要推送本地 `v0.1.0` Tag，也不要使用 `git push --tags`。
