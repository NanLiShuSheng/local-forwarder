---
name: latest-only-release
description: 当用户说“发布”“发布全版本”“打一个最新的win安装包”，或需要发布 Local Forwarder 安装包、保留本地 Windows 安装包到 release 目录、修改更新检查或下载流程、排查重复升级和腾讯云更新目录残留中间版本时使用。
---

# Local Forwarder 最新版本发布

## 本地打包口令

“打一个最新的win安装包”只构建当前工作区最新代码对应的 Windows x64 安装包，不递增版本号，不提交、推送或上传腾讯云。

1. 运行 `npm run package:release:win:x64`，完成构建和校验。
2. 构建成功后，立即把 Windows 安装器及其差分映射复制到项目根目录的 `release/`：

   ```bash
   version="$(node -p "require('./package.json').version")"
   mkdir -p release
   cp -p "dist/Local-Forwarder-Setup-${version}.exe" \
     "dist/Local-Forwarder-Setup-${version}.exe.blockmap" \
     release/
   test -s "release/Local-Forwarder-Setup-${version}.exe"
   test -s "release/Local-Forwarder-Setup-${version}.exe.blockmap"
   ```

3. 在结果中报告 `release/Local-Forwarder-Setup-<version>.exe` 的绝对路径。

`release/` 是本地安装包归档，不是临时构建目录：

- 不得清空 `release/`，也不得删除其中已有的安装包；后续构建、测试或常规清理都必须保留这些文件。
- 重复构建只允许覆盖同一版本的同名文件，不得删除其他版本。
- 不要只把安装器留在 `dist/`；后续 `npm run build`、`npm test` 或打包会清空 `dist/`。
- 只有用户明确要求清理本地安装包时，才可删除 `release/` 中的文件。

## 发布口令

“发布”和“发布全版本”都是完整发布流程：版本号递增、验证、提交并推送、构建、上传腾讯云。不要只构建不上传，也不要在推送成功前发布。

- **发布**：只发布 Windows x64。
- **发布全版本**：发布 Windows x64 + macOS x64/arm64。

每次发布都把 `package.json` 和 `package-lock.json` 的版本号增加 `0.0.2`，例如 `2.0.7` → `2.0.9`。不要按常规只增加 `0.0.1`。

### 执行顺序

1. 检查工作区，确认本次要提交的改动。
2. 递增版本号：

   ```bash
   new_version="$(node -e 'const v=require("./package.json").version.split(".").map(Number); v[2]+=2; process.stdout.write(v.join("."))')"
   npm version "$new_version" --no-git-tag-version --force
   ```

3. 运行 `npm test`；失败时停止，不提交、不发布。
4. 提交发布相关改动并推送到 `origin` 当前分支；推送失败时停止。
5. 构建并校验发布资产：
   - “发布”：`npm run package:release:win:x64`
   - “发布全版本”：先运行 `npm run package:release:win:x64`，再运行 `npm run package:release:mac:x64-arm64`
6. 把本次平台对应的当前版本资产复制到独立暂存目录，再运行 `scripts/publish-tencent.sh <staging-dir>`。

### 腾讯云资产范围

- “发布”只上传当前版本的 `Local-Forwarder-Setup-<version>.exe`、同版本 `.exe.blockmap` 和 `latest.yml`。暂存目录不要放 `latest-mac.yml`、`mac-update.json`、DMG 或 ZIP。
- “发布全版本”额外上传当前版本的 Intel/Apple Silicon DMG、macOS ZIP 及其 `.blockmap`、`latest-mac.yml` 和 `mac-update.json`。
- 只上传当前版本文件，避免旧版本进入暂存目录；服务端脚本会按线上清单清理旧资产。
- 发布 Windows 单平台时，不要删除腾讯云上仍由 `latest-mac.yml` 或 `mac-update.json` 引用的 macOS 文件。

### 边界

- 发布口令不创建或推送 `v*` Tag，也不创建 GitHub Release；Tag 会触发 `.github/workflows/release.yml` 发布全平台。
- 不部署官网，除非用户明确要求。
- 腾讯云凭据缺失或发布脚本失败时停止并报告；不得跳过验证或伪造发布成功。

## 目标

客户端永远下载服务器当前清单指向的版本；腾讯云发布目录不再保留已经过期的中间版本安装包。

## 客户端更新

- 用户点击下载更新时，先重新读取 `latest.yml` 或 `mac-update.json`，再调用下载。`electron-updater.downloadUpdate()` 使用上次检查缓存的版本信息，不能直接依赖启动时的更新卡片。
- 历史事故：0.3.6 启动时看到 0.3.7，服务器随后发布 0.3.8；点击下载仍会下载 0.3.7。下载前复检用于阻止该链路。
- 复检失败时返回错误，禁止回退下载已缓存的旧版本；复检后没有更新时直接结束，不启动下载。

## 云端发布

- 腾讯云发布脚本位于 `scripts/server/publish-updates.sh`，线上公开目录默认为 `/srv/local-forwarder-updates/public`。
- 发布顺序必须是：校验暂存文件 → 复制新资产 → 原子替换清单 → 清理旧资产。清理前不能删除旧文件，否则旧清单会短暂指向不存在的安装包。
- 发布目录只保留线上清单实际引用的文件：`latest.yml`、`latest-mac.yml`、`mac-update.json` 所引用的安装包，以及 `.exe`/`.zip` 对应的 `.blockmap`。
- Windows 与 macOS 可能单独发版；清理时必须保留另一个平台仍被线上清单引用的版本。
- 只清理 `Local-Forwarder-*` 发布资产，不得删除 `index.html`、`assets/`、`local/` 或其他网站文件。
- 发布失败时保留旧清单和旧资产，不允许留下半发布状态。

## 验证

修改更新或发布流程后运行：

```bash
npm test
node --import tsx --test test/electron/update-service.test.ts
node --import tsx --test test/electron/release-script-contract.test.ts
```

发布前按口令检查：

- “打一个最新的win安装包”：确认版本号未变化，`release/Local-Forwarder-Setup-<version>.exe` 与同名 `.blockmap` 均存在且非空，且没有提交、推送或上传。
- “发布”：只确认 `latest.yml` 与 Windows 安装器版本一致；线上 macOS 清单和资产保持原样。
- “发布全版本”：确认 `latest.yml`、`latest-mac.yml` 和 `mac-update.json` 都指向同一个待发布版本。

发布后确认目标版本文件存在，本次未发布的平台仍可下载，旧版本安装包已按线上清单清理。
