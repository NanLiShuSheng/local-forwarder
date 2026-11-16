# Local Forwarder 官网部署

官网源码位于 `website/`，通过腾讯云 Caddy 直接提供静态文件：

- 页面入口：`https://www.finbr.asia/`
- 完整下载页：`https://www.finbr.asia/local/download/`（保留 macOS 下载；根首页仅开放 Windows 下载）
- 静态根目录：`/srv/local-forwarder-updates/public`
- 更新清单：`https://www.finbr.asia/local-forwarder/latest.yml`
- macOS 清单：`https://www.finbr.asia/local-forwarder/mac-update.json`

页面运行时会读取以上两个清单，动态展示最新版本号、Windows 安装包和两种 macOS DMG 下载地址。站点不提供历史版本入口。

## 部署

部署脚本会把 `website/` 先上传到 `incoming/website-*` 暂存目录，再逐个文件原子替换到静态根目录。脚本不会删除 `public/` 中已有的更新安装包和清单。

Caddy 的 SPA 回退必须包含目录索引分支：`try_files {path} {path}/ /index.html`。缺少 `{path}/` 时，`/local/download/` 会回退到根 `index.html`，导致子路由页面引用错误的相对资源路径。

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
- `website/assets/app-overview.png`：首屏产品截图
- `website/assets/app-request.png`：请求工作台截图

部署后应确认：

- 首页、favicon 和产品截图返回 `200`
- `/local/download/` 返回 `200`，且样式、脚本、图片和 macOS 下载入口正常
- 页面显示线上最新版本，三个下载地址与更新清单一致
- `latest.yml`、`latest-mac.yml`、`mac-update.json` 保持 `Cache-Control: no-store`
- 安装包 Range 请求返回 `206 Partial Content`
