# GitHub Releases 自动更新实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `subagent-driven-development`（推荐）或 `executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）来跟踪进度。

**目标：** 为 Local Forwarder 接入 GitHub Releases 版本检测、用户确认下载、下载进度、重启安装，以及 Windows/macOS x64 的 Tag 发布流水线。

**架构：** 主进程新增可注入的更新服务，封装 `electron-updater` 并把状态通过白名单 IPC 推送给 renderer；renderer 使用独立的右下角持久更新卡片，普通错误仍走现有 5 秒 Toast。GitHub Actions 在匹配 `package.json` 版本的 `v*` Tag 上分别构建 Windows NSIS 和 macOS DMG/ZIP，最后由独立发布 job 上传安装包和 `latest*.yml`。

**技术栈：** Electron、`electron-updater`、electron-builder、React、TypeScript、GitHub Actions、Apple Developer ID 签名与 notarization。

---

## 文件地图

### 创建文件

- `electron/update-service.ts`：主进程更新适配器、状态机、并发保护和安装前停止服务。
- `src/renderer/components/UpdateCard.tsx`：右下角更新卡片及状态操作。
- `scripts/verify-release-tag.mjs`：校验 Git Tag 与 `package.json.version`。
- `scripts/verify-release-assets.mjs`：校验指定平台的安装包、更新元数据、版本和 SHA512 字段。
- `scripts/verify-macos-signing-env.mjs`：发布 job 中校验签名和公证环境变量。
- `scripts/notarize.mjs`：macOS CI 构建完成后执行 Apple notarization，非 GitHub Actions 本地构建不执行。
- `.github/workflows/release.yml`：Tag 触发的 Windows/macOS 构建、资产验证和 GitHub Release 发布。
- `test/electron/update-service.test.ts`：更新服务状态和生命周期测试。
- `test/electron/update-config-contract.test.ts`：依赖、builder 配置和发布脚本契约测试。
- `test/electron/release-workflow-contract.test.ts`：Release workflow 的触发器、权限、平台和资产契约测试。
- `test/renderer/update-card.test.ts`：更新卡片文案、按钮、状态和样式契约测试。

### 修改文件

- `package.json`、`package-lock.json`：运行时更新依赖、notarize 依赖和发布/验证脚本。
- `electron-builder.yml`：GitHub provider、macOS ZIP、签名运行时和 notarize hook。
- `electron/main.ts`：初始化更新服务、注册更新 IPC、启动后台检查和安全退出协作。
- `electron/preload.ts`：暴露最小更新 API 和状态事件订阅。
- `src/shared/contracts.ts`：更新状态、信息、进度、操作结果和 `ForwarderApi` 类型。
- `src/renderer/App.tsx`：读取更新状态、绑定 IPC 事件、处理检查/下载/安装并挂载卡片。
- `src/renderer/components/AppearancePage.tsx`：增加当前版本和手动检查入口。
- `src/renderer/styles.css`：更新卡片的浅色/深色不透明背景、层级、进度条和 Toast 间距。
- `test/electron/ipc-contract.test.ts`、`test/electron/preload-contract.test.ts`：补充更新通道和 preload 契约。
- `test/electron/package-config-contract.test.ts`、`test/electron/package-script-contract.test.ts`：补充更新目标、provider 和脚本契约。

## 任务 1：先建立失败的发布配置契约

**文件：**

- 创建：`test/electron/update-config-contract.test.ts`
- 修改：`test/electron/package-config-contract.test.ts`
- 修改：`test/electron/package-script-contract.test.ts`
- 修改：`package.json`、`package-lock.json`、`electron-builder.yml`

- [ ] **步骤 1：编写失败测试**

在 `test/electron/update-config-contract.test.ts` 写入以下测试，先锁定公开仓库、运行时依赖、macOS ZIP 和禁止自动下载所需的构建基础：

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub updater configuration targets the public release repository", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts: Record<string, string>;
  };
  const builder = await readFile("electron-builder.yml", "utf8");

  assert.equal(typeof packageJson.dependencies?.["electron-updater"], "string");
  assert.equal(typeof packageJson.devDependencies?.["@electron/notarize"], "string");
  assert.match(builder, /provider:\s*github/);
  assert.match(builder, /owner:\s*NanLiShuSheng/);
  assert.match(builder, /repo:\s*local-forwarder/);
  assert.match(builder, /-\s+zip/);
  assert.match(builder, /afterSign:\s*scripts\/notarize\.mjs/);
  assert.match(packageJson.scripts["package:release:win:x64"] ?? "", /--publish never/);
  assert.match(packageJson.scripts["package:release:mac:x64"] ?? "", /--publish never/);
});
```

同时在既有 package config/script 测试中增加断言：Windows 仍为 NSIS，macOS 同时包含 DMG 和 ZIP，发布脚本包含对应的资产验证脚本，普通本地打包脚本不包含 `--publish always`。

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx tsx --test test/electron/update-config-contract.test.ts test/electron/package-config-contract.test.ts test/electron/package-script-contract.test.ts
```

预期：FAIL，当前 `package.json` 没有 `electron-updater`/`@electron/notarize`，builder 没有 GitHub provider 和 ZIP target，发布脚本不存在。

- [ ] **步骤 3：实现最小配置**

执行 `npm install electron-updater@latest` 和 `npm install --save-dev @electron/notarize@latest`，让 npm 同步修改 `package.json` 与 `package-lock.json`。用 `apply_patch` 修改 `electron-builder.yml`，保留现有资源和 NSIS 配置，增加以下配置：

```yaml
publish:
  provider: github
  owner: NanLiShuSheng
  repo: local-forwarder
  releaseType: release

afterSign: scripts/notarize.mjs

mac:
  target:
    - dmg
    - zip
  hardenedRuntime: true
  gatekeeperAssess: false
```

在 `package.json.scripts` 增加：

```json
"verify:release:tag": "node scripts/verify-release-tag.mjs",
"verify:release:win": "node scripts/verify-release-assets.mjs win",
"verify:release:mac": "node scripts/verify-release-assets.mjs mac",
"package:release:win:x64": "npm run build && electron-builder --win nsis --x64 --publish never && npm run verify:win && npm run verify:release:win",
"package:release:mac:x64": "npm run build && electron-builder --mac dir zip --x64 --publish never && node scripts/create-dmg.mjs && npm run verify:package && npm run verify:release:mac"
```

`--publish never` 只禁止本地构建上传；因为 builder 仍有 GitHub publish 配置，它会生成 `latest.yml`/`latest-mac.yml`，最终上传由 Release job 完成。

- [ ] **步骤 4：运行测试确认通过**

运行：

```bash
npx tsx --test test/electron/update-config-contract.test.ts test/electron/package-config-contract.test.ts test/electron/package-script-contract.test.ts
```

预期：PASS。

- [ ] **步骤 5：提交**

```bash
git add package.json package-lock.json electron-builder.yml test/electron/update-config-contract.test.ts test/electron/package-config-contract.test.ts test/electron/package-script-contract.test.ts
git commit -m "build: configure GitHub release updater targets"
```

## 任务 2：实现主进程更新服务并先完成单元测试

**文件：**

- 创建：`test/electron/update-service.test.ts`
- 创建：`electron/update-service.ts`
- 修改：`src/shared/contracts.ts`

- [ ] **步骤 1：编写失败测试和可注入 fake adapter**

测试使用 fake adapter，不访问 GitHub，不依赖 Electron GUI。fake 暴露 `emit`，测试覆盖以下行为：

```ts
test("update service disables automatic download and maps updater events", async () => {
  const fake = createFakeUpdater();
  const states: UpdateState[] = [];
  const service = createUpdateService({
    currentVersion: "0.1.0",
    isPackaged: true,
    isSmokeMode: false,
    updater: fake,
    stopAll: async () => ({ ok: true }),
    publish: (state) => states.push(state),
  });

  assert.equal(fake.autoDownload, false);
  assert.equal(fake.autoInstallOnAppQuit, false);
  fake.emit("update-available", { version: "0.1.1", releaseDate: "2026-09-21T00:00:00.000Z" });
  assert.equal(service.getState().state, "available");
  assert.equal(service.getState().update?.version, "0.1.1");
  assert.equal(states.at(-1)?.state, "available");
});

test("download is user initiated and install stops all proxy instances first", async () => {
  const fake = createFakeUpdater();
  const stopAll = async () => ({ ok: true as const });
  const service = createUpdateService({ currentVersion: "0.1.0", isPackaged: true, isSmokeMode: false, updater: fake, stopAll, publish: () => undefined });

  fake.emit("update-available", { version: "0.1.1" });
  assert.equal(fake.downloadCalls, 0);
  await service.download();
  assert.equal(fake.downloadCalls, 1);
  fake.emit("update-downloaded", { version: "0.1.1" });
  await service.install();
  assert.equal(fake.quitAndInstallCalls, 1);
  assert.equal(fake.stopObserved, true);
});
```

fake 的事件名固定为 `checking-for-update`、`update-available`、`update-not-available`、`download-progress`、`update-downloaded`、`error`；fake 的 `autoDownload`、`autoInstallOnAppQuit`、`downloadCalls`、`quitAndInstallCalls` 用于断言副作用。

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx tsx --test test/electron/update-service.test.ts
```

预期：FAIL，`electron/update-service.ts` 和 `UpdateState` 尚不存在。

- [ ] **步骤 3：先定义共享更新类型，再实现最小更新服务**

在 `src/shared/contracts.ts` 定义以下共享类型，供主进程、preload、renderer 和测试共同使用：

```ts
export type UpdateStateKind = "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";

export interface UpdateInfoSnapshot {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
}

export interface UpdateProgressSnapshot {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateState {
  state: UpdateStateKind;
  currentVersion: string;
  update?: UpdateInfoSnapshot;
  progress?: UpdateProgressSnapshot;
  error?: string;
}
```

在 `electron/update-service.ts` 导入上述共享类型，只定义主进程专用的 adapter 和服务接口：

```ts
export interface UpdateAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  onCheckingForUpdate(listener: () => void): () => void;
  onUpdateAvailable(listener: (info: UpdateInfoSnapshot) => void): () => void;
  onUpdateNotAvailable(listener: () => void): () => void;
  onDownloadProgress(listener: (progress: UpdateProgressSnapshot) => void): () => void;
  onUpdateDownloaded(listener: (info: UpdateInfoSnapshot) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  isPackaged: boolean;
  isSmokeMode: boolean;
  updater?: UpdateAdapter;
  stopAll: () => Promise<{ ok: boolean; error?: string } | void>;
  publish: (state: UpdateState) => void;
}

export interface UpdateService {
  getState(): UpdateState;
  startBackgroundCheck(): Promise<void>;
  check(): Promise<{ ok: boolean; error?: string }>;
  download(): Promise<{ ok: boolean; error?: string }>;
  install(): Promise<{ ok: boolean; error?: string }>;
  dispose(): void;
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService;
```

`UpdateAdapter` 使用明确的回调注册方法包装真实 `autoUpdater`，不要把 Electron 的 EventEmitter 类型传播到测试和 shared contracts。构造时设置 `autoDownload = false`、`autoInstallOnAppQuit = false`；未打包、smoke 模式或没有 adapter 时不访问网络。`check()` 和 `download()` 在已有请求进行时复用 Promise；`install()` 只接受 `downloaded` 状态，先检查 `stopAll()` 返回值，失败时维持可重试的错误状态，不调用 `quitAndInstall()`。所有 adapter error 转为“检查更新失败”或“下载更新失败”等中文 fallback。

- [ ] **步骤 4：运行测试确认通过**

运行：

```bash
npx tsx --test test/electron/update-service.test.ts
```

预期：PASS，且测试输出不包含真实网络请求。

- [ ] **步骤 5：提交**

```bash
git add electron/update-service.ts test/electron/update-service.test.ts
git commit -m "feat: add controlled update service"
```

## 任务 3：接入 shared contracts、主进程 IPC 和 preload

**文件：**

- 修改：`src/shared/contracts.ts`
- 修改：`electron/main.ts`
- 修改：`electron/preload.ts`
- 修改：`test/electron/ipc-contract.test.ts`
- 修改：`test/electron/preload-contract.test.ts`

- [ ] **步骤 1：编写失败的 IPC 契约测试**

在 `test/electron/ipc-contract.test.ts` 的现有稳定通道断言中增加以下键值：

```ts
getAppVersion: "app:version:get",
getUpdateState: "update:state:get",
checkForUpdates: "update:check",
downloadUpdate: "update:download",
installUpdate: "update:install",
updateState: "update:state",
```

在 `test/electron/preload-contract.test.ts` 增加对编译产物的断言：

```ts
assert.match(preload, /getAppVersion/);
assert.match(preload, /getUpdateState/);
assert.match(preload, /checkForUpdates/);
assert.match(preload, /downloadUpdate/);
assert.match(preload, /installUpdate/);
assert.match(preload, /onUpdateState/);
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npm run build
npx tsx --test test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts
```

预期：FAIL，更新通道和 preload API 尚不存在。

- [ ] **步骤 3：增加共享类型和 preload API**

在 `src/shared/contracts.ts` 使用任务 2 已定义的 `UpdateStateKind`、`UpdateInfoSnapshot`、`UpdateProgressSnapshot`、`UpdateState`，并增加：

```ts
export interface UpdateOperationResult extends OperationResult {
  skipped?: boolean;
}

export interface ForwarderApi {
  // 保留现有 API
  getAppVersion(): Promise<string>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateOperationResult>;
  downloadUpdate(): Promise<UpdateOperationResult>;
  installUpdate(): Promise<UpdateOperationResult>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}
```

把六个通道加入 shared `IPC_CHANNELS` 和 preload 内部通道表。`onUpdateState` 必须保存 Electron listener 引用并返回 `removeListener` 清理函数，和现有 `onEncryptionProgress` 保持一致。

- [ ] **步骤 4：接入 main IPC 和生命周期**

在 `electron/main.ts` 使用同一组通道名：

- `getAppVersion` 返回 `app.getVersion()`。
- `getUpdateState` 返回服务缓存状态。
- `checkForUpdates`、`downloadUpdate`、`installUpdate` 委托给更新服务。
- 更新服务的 `publish` 遍历 `BrowserWindow.getAllWindows()`，发送 `update:state`。
- `loadService()` 成功后创建更新服务，再注册 IPC 和创建窗口。
- 窗口创建完成后调用 `void updateService.startBackgroundCheck()`；后台定时器只执行一次。
- `before-quit` 保留现有 `manager.stopAll()` 保护；安装流程在调用 `quitAndInstall()` 前已经停止服务，因此不会触发重复退出循环。

- [ ] **步骤 5：运行测试确认通过**

运行：

```bash
npm run build
npx tsx --test test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts test/electron/update-service.test.ts
```

预期：PASS；编译后的 `dist-electron/electron/main.js` 和 `preload.js` 不包含 shared contracts 的运行时 import。

- [ ] **步骤 6：提交**

```bash
git add src/shared/contracts.ts electron/main.ts electron/preload.ts test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts
git commit -m "feat: expose update lifecycle through IPC"
```

## 任务 4：实现 renderer 更新卡片和版本入口

**文件：**

- 创建：`src/renderer/components/UpdateCard.tsx`
- 修改：`src/renderer/App.tsx`
- 修改：`src/renderer/components/AppearancePage.tsx`
- 修改：`src/renderer/styles.css`
- 创建：`test/renderer/update-card.test.ts`

- [ ] **步骤 1：编写失败的 renderer 测试**

在 `test/renderer/update-card.test.ts` 固定以下验收断言：

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("update card exposes download and install actions", async () => {
  const source = await readFile("src/renderer/components/UpdateCard.tsx", "utf8");
  assert.match(source, /下载更新/);
  assert.match(source, /立即重启更新/);
  assert.match(source, /稍后更新/);
  assert.match(source, /下载进度/);
});

test("update card is persistent and visually separated from five-second toasts", async () => {
  const styles = await readFile("src/renderer/styles.css", "utf8");
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /UpdateCard/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*bottom:\s*88px/);
  assert.match(styles, /\.update-card[^\{]*\{[^}]*background:/);
  assert.doesNotMatch(source, /TOAST_DURATION_MS/);
});

test("appearance page exposes current version and manual check", async () => {
  const source = await readFile("src/renderer/components/AppearancePage.tsx", "utf8");
  assert.match(source, /当前版本/);
  assert.match(source, /检查更新/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx tsx --test test/renderer/update-card.test.ts
```

预期：FAIL，组件、版本入口和样式尚不存在。

- [ ] **步骤 3：实现 `UpdateCard`**

组件接收 `UpdateState`、`onDownload`、`onInstall`、`onDismiss`，只在 `available`、`downloading`、`downloaded` 或带目标版本的 `error` 状态渲染。使用 `<progress>` 或带 `role="progressbar"` 的元素，`aria-valuenow` 使用限制在 `0–100` 的百分比。下载中禁用重复下载，已下载只显示立即安装和稍后更新，关闭操作不启动 Toast 定时器。

卡片文案固定为中文：

```text
发现新版本
版本 0.1.0 → 0.1.1
下载更新
正在下载更新 42%
更新已下载
立即重启更新 / 稍后更新
```

- [ ] **步骤 4：接入 App 和 AppearancePage**

`AppContent` 启动时并行读取 `getAppVersion()` 和 `getUpdateState()`，订阅 `onUpdateState`，卸载时取消订阅。手动检查时：

- `checking` 禁用按钮并显示“正在检查”。
- `not-available` 调用 `notify({ kind: "success", message: "当前已是最新版本" })`。
- 操作返回失败调用 `notifyError(result.error, "检查更新失败")` 或对应中文 fallback。
- 下载和安装由卡片按钮触发，不在状态变化副作用中自动调用。

`AppearancePage` 新增“版本更新”区块，显示当前版本和检查按钮；卡片挂在 `AppContent` 的根层级，页面切换不卸载。

- [ ] **步骤 5：增加浅色/深色样式并运行测试**

在 `styles.css` 增加 `.update-card`、`.update-card-progress`、`.update-card-actions` 和主题变量。卡片必须使用不透明 `background`、现有边框/阴影语义，默认 `position: fixed; right: 20px; bottom: 88px; z-index` 高于内容且低于 Toast；小屏幕使用 `right: 12px` 和 `width: calc(100vw - 24px)`。

运行：

```bash
npx tsx --test test/renderer/update-card.test.ts test/renderer/toast.test.ts test/renderer/chinese-ui.test.ts
npm run build
```

预期：PASS，且构建成功。

- [ ] **步骤 6：提交**

```bash
git add src/renderer/components/UpdateCard.tsx src/renderer/App.tsx src/renderer/components/AppearancePage.tsx src/renderer/styles.css test/renderer/update-card.test.ts
git commit -m "feat: add renderer update card"
```

## 任务 5：增加 Release 校验脚本和 macOS 签名/公证入口

**文件：**

- 创建：`scripts/verify-release-tag.mjs`
- 创建：`scripts/verify-release-assets.mjs`
- 创建：`scripts/verify-macos-signing-env.mjs`
- 创建：`scripts/notarize.mjs`
- 创建或修改：`test/electron/release-script-contract.test.ts`

- [ ] **步骤 1：编写失败的脚本契约测试**

测试断言四个脚本存在，并包含固定的版本、元数据、签名环境和 notarization 入口：

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release scripts validate versions, update metadata, signing and notarization", async () => {
  const tag = await readFile("scripts/verify-release-tag.mjs", "utf8");
  const assets = await readFile("scripts/verify-release-assets.mjs", "utf8");
  const signing = await readFile("scripts/verify-macos-signing-env.mjs", "utf8");
  const notarize = await readFile("scripts/notarize.mjs", "utf8");
  assert.match(tag, /GITHUB_REF_NAME/);
  assert.match(tag, /package\.json/);
  assert.match(assets, /latest\.yml/);
  assert.match(assets, /latest-mac\.yml/);
  assert.match(assets, /sha512/);
  assert.match(signing, /MACOS_CERTIFICATE_BASE64/);
  assert.match(signing, /APPLE_APP_SPECIFIC_PASSWORD/);
  assert.match(notarize, /notarize/);
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx tsx --test test/electron/release-script-contract.test.ts
```

预期：FAIL，四个脚本尚不存在。

- [ ] **步骤 3：实现版本和资产验证**

`verify-release-tag.mjs` 读取 `process.env.GITHUB_REF_NAME`，没有该变量时读取第一个命令行参数；要求值匹配 `v${packageJson.version}`，否则抛出包含两者的错误。

`verify-release-assets.mjs` 接受 `win` 或 `mac`：

- `win` 检查 `dist/Local Forwarder Setup ${version}.exe`、`dist/latest.yml`，并验证 YAML 文本包含 `version: ${version}`、安装器文件名和 `sha512:`。
- `mac` 检查 `release/Local Forwarder-${version}.dmg`、`dist/*-mac.zip`、`dist/latest-mac.yml`，并验证 ZIP 文件名、版本和 `sha512:`。
- 缺少文件、文件为空或版本不一致时退出码为 1。

脚本只读取和验证，不删除已有产物。

- [ ] **步骤 4：实现签名和公证脚本**

`verify-macos-signing-env.mjs` 在 GitHub Actions 中要求 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 全部非空；本地非 CI 执行时输出“本地构建跳过签名环境检查”并退出成功。

`notarize.mjs` 导出 electron-builder `afterSign` hook，并使用 `@electron/notarize`：

```js
import path from "node:path";
import { notarize } from "@electron/notarize";

export default async function notarizeApp(context) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  const { appOutDir, packager } = context;
  await notarize({
    appBundleId: packager.appInfo.id,
    appPath: path.join(appOutDir, `${packager.appInfo.productFilename}.app`),
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
}
```

在调用 hook 前检查五个凭据均非空；缺少任一凭据时抛出固定中文错误且不把凭据值写入日志，阻止 CI 发布未公证包。

- [ ] **步骤 5：运行脚本验证**

运行：

```bash
GITHUB_REF_NAME=v0.1.0 node scripts/verify-release-tag.mjs
node scripts/verify-macos-signing-env.mjs
npx tsx --test test/electron/release-script-contract.test.ts
```

预期：Tag 校验成功，本地签名环境检查成功，契约测试 PASS。再运行 `GITHUB_REF_NAME=v0.1.1 node scripts/verify-release-tag.mjs`，预期退出码为 1。

- [ ] **步骤 6：提交**

```bash
git add scripts/verify-release-tag.mjs scripts/verify-release-assets.mjs scripts/verify-macos-signing-env.mjs scripts/notarize.mjs test/electron/release-script-contract.test.ts
git commit -m "build: validate release assets and macOS signing"
```

## 任务 6：编写 GitHub Actions Tag 发布工作流

**文件：**

- 创建：`.github/workflows/release.yml`
- 创建：`test/electron/release-workflow-contract.test.ts`

- [ ] **步骤 1：编写失败的 workflow 契约测试**

测试读取 `.github/workflows/release.yml`，断言包含：

```ts
assert.match(workflow, /tags:/);
assert.match(workflow, /v\*/);
assert.match(workflow, /contents:\s*write/);
assert.match(workflow, /windows-latest/);
assert.match(workflow, /macos-13/);
assert.match(workflow, /package:release:win:x64/);
assert.match(workflow, /package:release:mac:x64/);
assert.match(workflow, /latest\.yml/);
assert.match(workflow, /latest-mac\.yml/);
assert.match(workflow, /MACOS_CERTIFICATE_BASE64/);
assert.match(workflow, /gh release create/);
```

- [ ] **步骤 2：运行测试确认失败**

运行：

```bash
npx tsx --test test/electron/release-workflow-contract.test.ts
```

预期：FAIL，Release workflow 尚不存在。

- [ ] **步骤 3：创建完整 workflow**

工作流必须使用以下结构：

```yaml
name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run verify:release:tag
      - run: npm run package:release:win:x64
        env:
          GITHUB_REF_NAME: ${{ github.ref_name }}
      - run: node scripts/smoke-packaged.mjs
      - run: node scripts/smoke-win-resources.mjs
      - uses: actions/upload-artifact@v4
        with:
          name: local-forwarder-windows-release
          if-no-files-found: error
          path: |
            dist/Local Forwarder Setup *.exe
            dist/latest.yml

  build-macos:
    needs: build-windows
    runs-on: macos-13
    env:
      CSC_LINK: ${{ secrets.MACOS_CERTIFICATE_BASE64 }}
      CSC_KEY_PASSWORD: ${{ secrets.MACOS_CERTIFICATE_PASSWORD }}
      APPLE_ID: ${{ secrets.APPLE_ID }}
      APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
      APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      - run: npm test
      - run: node scripts/verify-macos-signing-env.mjs
      - run: npm run verify:release:tag
      - run: npm run package:release:mac:x64
        env:
          GITHUB_REF_NAME: ${{ github.ref_name }}
      - uses: actions/upload-artifact@v4
        with:
          name: local-forwarder-macos-release
          if-no-files-found: error
          path: |
            release/Local Forwarder-*.dmg
            dist/*-mac.zip
            dist/latest-mac.yml

  publish:
    needs: [build-windows, build-macos]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: local-forwarder-windows-release
          path: release-assets/windows
      - uses: actions/download-artifact@v4
        with:
          name: local-forwarder-macos-release
          path: release-assets/macos
      - env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "$GITHUB_REF_NAME" \
            release-assets/windows/*.exe \
            release-assets/windows/latest.yml \
            release-assets/macos/*.dmg \
            release-assets/macos/*-mac.zip \
            release-assets/macos/latest-mac.yml \
            --verify-tag \
            --title "Local Forwarder $GITHUB_REF_NAME" \
            --generate-notes
```

如果 `workflow_dispatch` 没有 Tag 上下文，第一步 `verify:release:tag` 必须失败，防止手工运行生成没有对应版本的 Release。macOS job 固定使用 Intel x64 runner `macos-13`。

- [ ] **步骤 4：运行契约测试和 YAML 文本检查**

运行：

```bash
npx tsx --test test/electron/release-workflow-contract.test.ts
git diff --check
```

预期：PASS，workflow 文本无空白错误。真实 Actions 运行由 Tag 推送触发，不在本地伪造发布权限。

- [ ] **步骤 5：提交**

```bash
git add .github/workflows/release.yml test/electron/release-workflow-contract.test.ts
git commit -m "ci: publish signed builds to GitHub Releases"
```

## 任务 7：全量验证、打包冒烟和发布前检查

**文件：**

- 修改：`docs/WORK-PLAN.md`，记录 GitHub Releases 功能和外部 Secrets 前置条件。

- [ ] **步骤 1：运行全量测试和构建**

运行：

```bash
npm test
npm run build
git diff --check
```

预期：全量测试通过、renderer 和 Electron 主进程构建成功、diff 检查无输出。

- [ ] **步骤 2：验证本地 Tag 检查和更新服务禁用路径**

运行：

```bash
GITHUB_REF_NAME=v0.1.0 npm run verify:release:tag
npx tsx --test test/electron/update-service.test.ts test/electron/release-script-contract.test.ts
```

预期：版本校验成功；测试确认开发/smoke 模式不访问 GitHub，普通本地打包不上传 Release。

- [ ] **步骤 3：在可用的 Intel macOS 环境执行 macOS 产物验证**

运行：

```bash
npm run package:release:mac:x64
```

预期：生成 `release/Local Forwarder-0.1.0.dmg`、`dist/*-mac.zip` 和 `dist/latest-mac.yml`；DMG、ZIP、app.asar、协议资源、版本和 SHA512 验证通过。没有 Apple Secrets 的本地构建保持未签名，不执行 notarization。

- [ ] **步骤 4：在 Windows x64 runner 执行 Windows 产物验证**

运行：

```powershell
npm run package:release:win:x64
node scripts/smoke-packaged.mjs
node scripts/smoke-win-resources.mjs
```

预期：生成 NSIS 安装器、`dist/latest.yml` 和 x64 unpacked 包，现有协议资源、端口恢复和 packaged smoke 全部通过。

- [ ] **步骤 5：配置 GitHub Secrets 后推送第一个 Tag**

在仓库 `Settings → Secrets and variables → Actions` 创建以下 Secrets：

```text
MACOS_CERTIFICATE_BASE64
MACOS_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

将当前 `package.json.version` 设为 `0.1.0` 的提交推送到 `main`，再执行：

```bash
git tag v0.1.0
git push origin v0.1.0
```

预期：Windows job、macOS 签名/公证 job、publish job 依次成功，GitHub Release 包含 NSIS、DMG、macOS ZIP、`latest.yml` 和 `latest-mac.yml`。

- [ ] **步骤 6：执行两版本自动更新验收**

将版本提升到 `0.1.1` 后重复测试：旧版客户端启动发现新版本；点击下载显示进度；点击立即更新前代理停止；应用重启后版本为 `0.1.1`，代理实例、端口、规则、登录缓存和主题设置均保留。断网和删除资产场景确认当前版本仍可运行，错误只显示中文 Toast。

- [ ] **步骤 7：提交工作计划进度和最终实现**

```bash
git add docs/WORK-PLAN.md
git commit -m "docs: record GitHub release update workflow"
```

## 任务 8：最终代码审查与交接

- [ ] **步骤 1：确认变更范围**

运行：

```bash
git status --short
git log --oneline -8
git diff --stat
```

确认只包含更新服务、IPC、renderer 更新卡片、打包配置、发布脚本、workflow、测试和工作计划，不覆盖用户既有未提交改动。

- [ ] **步骤 2：确认发布前安全项**

检查仓库中没有 `GH_TOKEN`、Apple 密码、证书原文、私有下载 URL 或测试账号；客户端构建产物只包含公开 GitHub provider 配置和 `app-update.yml`，不包含 Actions Secrets。

- [ ] **步骤 3：交接发布约定**

记录日常发布顺序：修改两个 package 版本文件、运行全量测试、提交、创建匹配的 `vX.Y.Z` Tag、查看 Actions、确认 Release 资产和 `latest*.yml` 完整。不要直接从未匹配 Tag 的分支触发发布。
