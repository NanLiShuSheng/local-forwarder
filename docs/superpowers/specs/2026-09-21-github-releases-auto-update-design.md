# GitHub Releases 自动更新设计

## 背景

项目准备发布到公开 GitHub 仓库 `NanLiShuSheng/local-forwarder`，需要让已安装客户端能够检测新版本、由用户直接下载更新，并在下载完成后重启安装。当前项目仅有 macOS DMG 和 Windows NSIS 的本地/CI 打包流程，没有更新依赖、更新 IPC、更新界面或 Release 发布工作流。

本次采用 `electron-updater` 配合 GitHub Releases。发布产物和更新元数据由 GitHub Actions 构建并上传，客户端不内置 GitHub Token。

## 目标与边界

### 目标

- 使用 `v0.1.1`、`v0.1.2` 形式的 Git Tag 触发 GitHub Release 构建。
- Windows x64 和 macOS Intel x64 都生成可被 `electron-updater` 识别的安装包及更新元数据。
- 应用启动后后台检查一次更新；用户也可以在“外观”页面手动检查。
- 发现新版本后，在右下角显示可操作的更新卡片，支持下载进度、稍后处理和立即重启更新。
- 更新前停止正在运行的代理实例，保留 `userData` 中的配置、缓存和登录数据。
- 检查、下载和安装失败时使用现有中文 Toast，不把英文异常堆叠到页面正文中。

### 不纳入范围

- 不实现增量更新、Beta/测试更新通道或自定义更新服务器。
- 不在客户端保存 GitHub Token，也不为私有仓库设计鉴权代理。
- 不改变现有代理配置模型、服务协议、页面导航和普通错误 Toast 的 5 秒自动隐藏规则。
- 不在本地开发模式执行真实更新检查；开发模式只保留可测试的禁用行为。

## 发布平台与版本规则

| 项目 | 规则 |
| --- | --- |
| GitHub 仓库 | `NanLiShuSheng/local-forwarder` |
| 可见性 | Public |
| 默认分支 | `main` |
| 当前版本 | `0.1.0` |
| 发布 Tag | 必须是 `v` 加完整 SemVer，例如 `v0.1.1` |
| 发布平台 | Windows x64、macOS Intel x64 |
| Windows 更新包 | NSIS 安装器 + `latest.yml` |
| macOS 更新包 | DMG（首次安装）+ ZIP（自动更新）+ `latest-mac.yml` |

发布工作流在执行前校验 Tag 去掉 `v` 后与 `package.json.version` 完全一致，避免产生无法被客户端识别的版本。

## 用户流程

### 检查更新

1. 打包应用启动并完成主窗口创建。
2. 主进程延迟约 10 秒执行一次后台检查，避免阻塞启动和代理加载。
3. 用户在“外观”页面点击“检查更新”时，主进程执行同一检查逻辑；并发检查复用当前请求，不重复访问 GitHub。
4. 没有更新时显示“当前已是最新版本”的短 Toast；开发模式或不支持的环境不访问网络。

### 下载与安装

1. 检查到新版本后，右下角显示持久更新卡片，展示当前版本、目标版本和“下载更新”按钮。
2. 用户点击后才开始下载，卡片展示百分比、已下载大小和速度；下载期间应用和代理服务继续可用。
3. 下载完成后卡片展示“立即重启更新”和“稍后更新”。
4. 用户选择立即更新时，主进程先调用现有 `manager.stopAll()`；停止成功后调用 `autoUpdater.quitAndInstall()`。
5. 停止失败时不退出应用，显示中文错误 Toast，并保留“立即重试”操作。
6. 用户关闭或选择稍后更新时，不取消已下载文件；当前会话不因同一版本的后台检查再次弹出卡片，手动检查仍可重新显示。

### 状态与错误

更新服务维护以下状态：`idle`、`checking`、`available`、`downloading`、`downloaded`、`not-available`、`error`。主进程保存最新状态，渲染进程加载时先通过 IPC 读取一次，再订阅后续事件，避免错过启动阶段的更新事件。

普通错误 Toast 仍使用右下角、5 秒自动隐藏和感叹号图标；更新卡片不自动隐藏，因为下载进度和安装按钮必须持续可用。更新卡片位于 Toast 上方，避免两个提示层重叠。

## 技术架构

### electron-updater 封装

新增主进程更新服务，职责限定为：

- 在 `app.isPackaged` 且不是 smoke 模式时初始化 `autoUpdater`。
- 设置 `autoDownload = false` 和 `autoInstallOnAppQuit = false`，禁止无确认下载或退出时静默安装。
- 监听 `checking-for-update`、`update-available`、`update-not-available`、`download-progress`、`update-downloaded` 和 `error`，统一转换为共享更新状态。
- 对检查和下载操作做并发保护，向所有窗口广播状态，并保存当前状态供新渲染进程读取。
- 在执行安装前停止所有代理实例。

`electron-builder.yml` 配置 GitHub provider：owner 为 `NanLiShuSheng`，repo 为 `local-forwarder`，发布类型为正式 Release。客户端只读取公开 Release 的元数据和资产。

### IPC 与共享类型

在 `src/shared/contracts.ts` 增加更新信息、下载进度、更新状态和以下 API：

- 获取当前应用版本。
- 获取当前更新状态。
- 检查更新。
- 开始下载更新。
- 重启并安装更新。
- 订阅更新状态事件并返回取消订阅函数。

Preload 只暴露上述最小接口；所有 IPC 继续经过现有 renderer 信任策略，不把 `autoUpdater` 或 Electron 模块暴露给页面。

### Renderer 更新卡片

新增独立更新卡片组件，由 `AppContent` 统一挂载，避免随导航页面卸载。卡片包含：

- 新版本提示和版本号。
- 下载按钮。
- 进度条、百分比、速度和状态文案。
- 下载完成后的立即更新/稍后更新操作。
- 可关闭按钮和可访问名称。

“外观”页面增加当前版本和手动检查入口。更新卡片使用现有主题变量，在浅色和深色主题下保持不透明背景、边框和阴影；错误文案经现有中文错误归一化处理，不展示原始英文异常。

## GitHub Actions 发布流程

新增 tag 发布工作流，保留现有 Windows 普通 CI：

1. 仅响应 `push.tags: ["v*"]`，并授予 `contents: write`。
2. Windows x64 job 执行 `npm ci`、全量测试、构建、NSIS 打包、现有 Windows 资源与 smoke 验证，然后使用 `GH_TOKEN` 发布 Windows 安装器和 `latest.yml`。
3. macOS Intel x64 job 在 Windows job 成功后执行相同的测试和构建，生成 DMG、ZIP 和 `latest-mac.yml`，并发布到同一个 Tag Release。
4. Release 只包含可分发资产和更新元数据，不上传 `win-unpacked` 等调试目录。
5. Release 资产出现缺失、版本不一致、更新元数据缺失或签名/公证失败时，工作流失败，不创建可供客户端消费的不完整发布。

macOS 发布使用以下固定的 GitHub Actions Secrets，不把凭据写入仓库：

- `MACOS_CERTIFICATE_BASE64`
- `MACOS_CERTIFICATE_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

macOS 自动更新要求 Developer ID Application 签名和 Apple 公证；工作流在没有这些 Secrets 时明确失败。Windows 代码签名不作为本次自动更新的硬前置条件，但可在后续通过 electron-builder 的证书 Secrets 接入以降低 SmartScreen 警告。

## 数据、安全与兼容性

- 更新只替换安装包内的应用文件，不删除 `app.getPath("userData")` 下的配置、代理实例、缓存、登录缓存和加密目录偏好。
- 更新 URL 和 Release 资产固定由 electron-builder 生成的 GitHub provider 配置决定，不接受渲染进程传入任意下载地址。
- 下载和安装操作只能由可信 renderer 通过白名单 IPC 发起。
- 网络不可用、没有 Release、版本元数据损坏、签名验证失败和下载中断都回到可重试状态，不影响当前已安装版本继续运行。
- 首次发布 `v0.1.0` 作为安装基线；之后必须先修改 `package.json.version`，再创建对应 `v` Tag。

## 测试与验收

### 自动化测试

- 更新服务单元测试：开发模式跳过、已打包模式初始化、状态事件映射、禁止自动下载、重复检查复用、下载进度、下载完成和安装前停止代理。
- IPC/Preload 契约测试：更新 API、事件取消订阅、参数白名单和共享类型保持一致。
- Renderer 测试：可用/下载中/已完成/错误状态的卡片文案与操作按钮；更新卡片不使用 5 秒 Toast 定时器；主题样式包含不透明背景。
- 打包配置和 workflow 契约测试：GitHub owner/repo、macOS `dmg + zip`、Windows NSIS、tag 触发、`contents: write` 和必要 Release 资产。
- 发布资产验证：版本号、`latest.yml`、`latest-mac.yml`、安装包和 SHA512 字段完整且匹配构建产物。

### 手工验收

1. 发布 `v0.1.0`，在 Windows x64 和 Intel macOS 完成首次安装。
2. 将版本号改为 `0.1.1`，发布第二个 Release。
3. 从 `0.1.0` 启动应用，确认右下角发现 `0.1.1`，点击后能看到下载进度。
4. 下载完成后点击立即更新，确认代理停止、应用重启并显示 `0.1.1`。
5. 重启后确认代理实例、端口、规则、登录缓存和主题设置仍然存在。
6. 断网、删除某个平台更新资产或模拟下载失败，确认当前版本仍可使用，错误只通过中文 Toast 提示。

## 发布操作约定

实现完成后，日常发布只需要：

1. 修改 `package.json` 和 `package-lock.json` 的版本。
2. 运行全量验证并提交代码。
3. 创建并推送匹配的 Tag，例如 `git tag v0.1.1 && git push origin v0.1.1`。
4. 在 GitHub Actions 查看 Windows、macOS 构建、签名、公证和 Release 资产上传结果。

本地打包仍可使用现有命令；本地不会向 GitHub 发布，也不会执行真实自动更新下载。
