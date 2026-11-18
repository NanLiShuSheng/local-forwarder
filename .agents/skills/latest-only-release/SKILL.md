---
name: latest-only-release
description: 当发布 Local Forwarder 安装包、修改更新检查或下载流程，或排查重复升级、腾讯云更新目录残留中间版本时使用。
---

# Local Forwarder 最新版本发布

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

发布前确认 `latest.yml`、`latest-mac.yml` 和 `mac-update.json` 都指向同一个待发布版本；发布后确认目标版本文件存在，旧版本安装包已删除。
