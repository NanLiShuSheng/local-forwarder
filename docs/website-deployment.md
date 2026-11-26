# Local Forwarder 官网部署

官网源码位于 `website/`，通过腾讯云 Caddy 直接提供静态文件：

- 生产首页：`https://www.finbr.asia/`（主下载入口，仅开放 Windows 下载；macOS 入口保持不可用状态）
- 兼容入口：`https://www.finbr.asia/local/download/`（开放 Windows、macOS Intel 与 Apple Silicon 下载）
- 静态根目录：`/srv/local-forwarder-updates/public`
- 更新清单：`https://www.finbr.asia/local-forwarder/latest.yml`
- macOS 清单：`https://www.finbr.asia/local-forwarder/mac-update.json`

生产首页读取 `latest.yml`，动态展示最新 Windows 版本号与安装包。`/local/download/` 额外读取 `mac-update.json`，动态开放 Intel 与 Apple Silicon DMG 下载。站点不提供历史版本入口。

## 部署

部署脚本会把 `website/` 先上传到 `incoming/website-*` 暂存目录，再逐个文件原子替换到静态根目录。脚本不会删除 `public/` 中已有的更新安装包和清单。

Caddy 的 SPA 回退必须包含目录索引分支：`try_files {path} {path}/ /index.html`。缺少 `{path}/` 时，`/local/download/` 会回退到根 `index.html`，导致子路由页面引用错误的相对资源路径。

官网 HTML、`main.js` 和 `styles.css` 必须返回 `Cache-Control: no-cache, must-revalidate`，否则浏览器可能继续使用发布前的旧页面。

```bash
TENCENT_SSH_HOST=43.142.243.244 \
TENCENT_SSH_USER=deploy \
TENCENT_SSH_KEY=/Users/hdw/.ssh/finbr_update_deploy_20261114_ed25519 \
./scripts/publish-tencent-website.sh
```

`TENCENT_RELEASE_ROOT` 默认是 `/srv/local-forwarder-updates`，通常无需设置。

## 资源

- `website/favicon.svg`：浏览器 Tab 图标源文件
- `website/favicon-32.png`：PNG fallback
- `website/apple-touch-icon.png`：Safari / iOS 图标
- `website/assets/app-workbench-prototype.png`：首屏工作台白板原型图
- `website/assets/app-request-prototype.png`：请求调试白板原型图
- `website/assets/app-cache-prototype.png`：action100/104/105 请求缓存白板原型图

部署后应确认：

- 生产首页、favicon 和三张白板原型图返回 `200`
- 首页在 1440 / 768 / 390 宽度下无横向溢出，三张原型图保持 16:10 且不被裁切
- `/local/download/` 作为兼容入口返回 `200`，macOS Intel 与 Apple Silicon 下载可用
- 页面显示线上最新版本，Windows 下载地址与 `latest.yml` 一致
- `/local/download/` 的 macOS 下载地址与 `mac-update.json` 一致
- 官网 HTML、`main.js` 和 `styles.css` 返回 `Cache-Control: no-cache, must-revalidate`
- `latest.yml`、`latest-mac.yml`、`mac-update.json` 保持 `Cache-Control: no-store`
- 安装包 Range 请求返回 `206 Partial Content`
