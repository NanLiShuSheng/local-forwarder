# GitHub Releases 自动更新交接文档

日期：2026-09-21  
状态：暂停，明天继续

## 目标

为 Local Forwarder 接入 GitHub Releases 自动更新：应用检测新版本，用户手动下载，显示下载进度，下载完成后停止代理并重启安装。

GitHub 仓库已确认：`NanLiShuSheng/local-forwarder`，公开仓库，默认分支 `main`。

## 已完成

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

## 当前未完成问题

任务 2 的规格审查发现一个必须先修复的问题，修复子代理已在今天暂停时停止，尚未产生 follow-up commit：

1. [`electron/update-service.ts`](../../../electron/update-service.ts) 当前使用 `downloadReady` 标记判断是否允许安装。规格要求必须检查当前 `state === "downloaded"`。
2. 如果下载完成后状态变为 `checking`、`downloading` 或 `error`，当前实现仍可能调用 `stopAll()` 和 `quitAndInstall()`。
3. 需要补充测试：
   - 从 `downloaded` 转为非 `downloaded` 后，`install()` 必须失败。
   - 此时不得调用 `stopAll()` 或 `quitAndInstall()`。
   - `updater` 未提供时，check/download/install 不应访问任何 adapter。

当前没有针对这项修复的未提交代码；工作树保留任务 2 已提交版本。

## 明天第一步

在工作树中执行：

```bash
cd /Users/hdw/proxy/.worktrees/local-forwarder
git status --short
git log -8 --oneline
npx tsx --test test/electron/update-service.test.ts
```

然后修复 `downloadReady` 问题：

- `install()` 入口改为检查 `state.state === "downloaded"`。
- 状态离开 `downloaded` 后立即禁止安装。
- 增加上述两个回归测试。
- 只提交 `electron/update-service.ts` 和 `test/electron/update-service.test.ts` 的 follow-up commit。
- 重新执行任务 2 的规格审查，再执行代码质量审查；两者都通过后才能进入任务 3。

建议 follow-up 提交信息：

```text
fix: guard update installation by current state
```

## 后续任务顺序

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

当前分支为 `local-forwarder`。除本交接相关提交外，工作树仍有大量既有未提交修改，包括核心服务、renderer、Toast、测试和文档文件。这些修改属于用户现有工作，不要整理、回退或批量格式化。
