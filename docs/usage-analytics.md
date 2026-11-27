# 应用启动与使用场景统计（自建 Umami）

应用启动成功且主窗口创建后，Electron 主进程向自建 Umami 发送一次 `/app_launch` 页面访问。客户端使用持久化的匿名安装 UUID 作为 Umami 的独立访客 ID，并附带应用版本、平台、架构、系统和语言。不上报账号、配置、Token、请求内容或功能操作内容。

当前“使用场景”指启动画像维度，不是具体功能点击率。如果后续需要统计某个功能的使用率，应单独定义非敏感事件名和埋点位置，不要记录页面内容或配置。

## 指标口径

| 指标 | 查看方式 | 口径 |
| --- | --- | --- |
| 每日启动次数 | Umami Pageviews，或下方 SQL | `/app_launch` 页面访问数 |
| 月活设备数 | 下方 SQL | 近 30 天产生过 `/app_launch` 的不同 `distinct_id` |
| 使用场景分布 | 下方事件属性 SQL | 版本、平台、架构、系统版本、语言 |

- 同一设备一天启动多次会累计多次 Pageviews。
- Umami 后台的 Unique visitors 按会话去重，而会话 ID 会混入 IP、User-Agent 和轮换盐，因此它只是月活的近似值，不能当作精确设备数。
- 正式月活请使用 PostgreSQL 中 `session.distinct_id` 去重查询。
- 开发环境和 `--smoke` 模式不上报；macOS 点击 Dock 重新打开窗口不会重复统计。

## 上报字段

| 字段 | 示例 | 用途 |
| --- | --- | --- |
| `payload.id` | 匿名安装 UUID | Umami `distinct_id` |
| `payload.url` | `/app_launch?appVersion=2.1.15&platform=darwin&arch=arm64` | 页面访问标识 |
| `payload.language` | `zh-CN` | 语言 |
| `payload.data.app_version` | `2.1.15` | 版本分布 |
| `payload.data.platform` | `darwin` / `win32` | 平台分布 |
| `payload.data.arch` | `arm64` / `x64` | 架构分布 |
| `payload.data.os_version` | `15.2.0` | 系统版本分布 |
| `payload.data.locale` | `zh-CN` | 语言分布 |

Umami v3.5 的 `/api/send` 没有客户端 `sessionId` 字段；会话由服务端根据 `payload.id`、IP、User-Agent 等生成。请求 3 秒超时，失败静默丢弃，不重试，也不阻塞启动。

## 数据流

```text
Local Forwarder 主进程
  -> https://analytics.finbr.asia/api/send
  -> Caddy（后台页面 Basic Auth；API 由 Umami 自身鉴权）
  -> Umami 3.5.0 + PostgreSQL（Docker，仅绑定 127.0.0.1:3000）
  -> Umami 后台或 PostgreSQL 只读查询
```

## 部署 Umami

以下步骤从本地项目目录发起，容器运行在腾讯云生产服务器。服务器需要 Docker、Docker Compose v2、`curl`、`openssl` 和部署账号权限。

### 1. DNS 与网络

1. 添加 DNS A 记录：`analytics.finbr.asia` 指向 `43.142.243.244`。
2. 确认安全组已开放 `80/443`，但不要开放 Umami 的 `3000` 端口。
3. 确认部署账号可以执行 `docker compose`，或具备 `sudo -n docker` 免交互权限。部署脚本会在直接访问 Docker 失败时自动回退到 `sudo -n`。

### 2. 一键部署容器

在项目根目录执行：

```bash
TENCENT_SSH_HOST=43.142.243.244 \
TENCENT_SSH_USER=deploy \
TENCENT_SSH_KEY="$HOME/.ssh/finbr_update_deploy_20261114_ed25519" \
./scripts/deploy-umami.sh
```

脚本会写入 `/srv/local-forwarder-umami/`，生成权限为 `0600` 的 `.env`，固定使用 `umamisoftware/umami:3.5.0`，启动 PostgreSQL 和 Umami，并轮询 `/api/heartbeat` 与数据库健康状态最多 30 次。它不会修改生产 Caddyfile。

如需换目录，设置 `UMAMI_DEPLOY_ROOT`。首次部署后请备份 `.env`；`POSTGRES_PASSWORD` 丢失后不能直接重新生成。

默认使用 Docker Hub 的 `umamisoftware/umami:3.5.0`，可通过腾讯云 Docker Hub 镜像加速拉取。如该镜像也不可用，再把 `.env` 的 `UMAMI_IMAGE` 换成可访问的 Umami 3.5.x 镜像。不要使用 MySQL 或 SQLite 变体。

手工部署时可把 `deploy/umami/` 上传到该目录，复制 `.env.example` 为 `.env`，并生成三个密钥：

```bash
openssl rand -hex 24  # POSTGRES_PASSWORD
openssl rand -hex 32  # UMAMI_APP_SECRET
openssl rand -hex 32  # UMAMI_TWO_FACTOR_ENCRYPTION_KEY
docker compose up -d
```

### 3. Caddy 反向代理与后台密码

把 `deploy/umami/Caddyfile.example` 的站点块加入现有 Caddyfile。先在服务器生成后台密码哈希：

```bash
caddy hash-password --plaintext '替换成你的后台密码'
```

把完整输出（以 `$2a$` 开头）替换模板里的 `REPLACE_WITH_CADDY_PASSWORD_HASH`，然后校验并重载：

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Basic Auth 只保护后台页面和静态资源；`/api/*` 直接交给 Umami 自身鉴权，其中 `POST /api/send` 是客户端唯一无需 Umami 登录的采集端点。`/api/send` 还限制了 16 KB 请求体。

### 4. 创建 Umami 网站

1. 打开 `https://analytics.finbr.asia`，首次登录默认账号为 `admin`、密码为 `umami`，登录后立即修改密码。
2. 新增网站，名称填写 `Local Forwarder`，域名填写 `local-forwarder.local`。
3. 复制该网站的 Website ID（UUID）。

### 5. 写入 Website ID 并重新打包

把 Website ID 填入 `electron/usage-analytics.ts` 的 `USAGE_ANALYTICS_WEBSITE_ID`，然后重新构建安装包。该值留空时生产环境不会发起上报。

临时验证已打包应用时，可以在启动进程的环境中设置 `LOCAL_FORWARDER_UMAMI_WEBSITE_ID` 和 `LOCAL_FORWARDER_UMAMI_ENDPOINT` 覆盖配置。这两个变量在运行时读取，不会在 `npm run build` 时写入安装包；正式发布仍应填写 `USAGE_ANALYTICS_WEBSITE_ID` 常量并重新打包。

## 上线验证

服务端接收验证（Website ID 换成实际值）：

```bash
curl -i -X POST https://analytics.finbr.asia/api/send \
  -A 'Mozilla/5.0 (compatible; LocalForwarder)' \
  -H 'content-type: application/json' \
  -d '{"type":"event","payload":{"website":"<WEBSITE_ID>","hostname":"local-forwarder","url":"/app_launch?appVersion=2.1.15&platform=darwin&arch=arm64","referrer":"","title":"Local Forwarder","language":"zh-CN","id":"00000000-0000-4000-8000-000000000001","data":{"app_version":"2.1.15","platform":"darwin","arch":"arm64","os_version":"15.2.0","locale":"zh-CN"}}}'
```

正常返回 `200`，并包含服务端生成的 `sessionId` 和 `visitId`。Umami 默认过滤机器人 User-Agent；直接用 curl 或 Node 的默认 UA 可能只返回 `{"beep":"boop"}` 而不入库，所以验证请求必须使用上面的 `-A`。随后检查最新记录：

```bash
cd /srv/local-forwarder-umami
docker compose exec -T database psql -U umami -d umami -c \
  "SELECT url_path, url_query, created_at FROM website_event ORDER BY created_at DESC LIMIT 5;"
```

安装包验证时启动应用，确认用户数据目录下生成 `usage-install-id`，并且后台 Pageviews 增加一次。再次启动会增加 Pageviews，但不会改变该安装的 UUID。

## 常用查询

在服务器执行：

```bash
cd /srv/local-forwarder-umami
docker compose exec -T database psql -U umami -d umami
```

以下查询把 `<WEBSITE_ID>` 替换为实际 UUID 后执行。

### 近 30 天每日启动次数

```sql
SELECT (e.created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
       count(*)::int AS launches
FROM website_event e
WHERE e.website_id = '<WEBSITE_ID>'
  AND e.url_path = '/app_launch'
  AND e.created_at >= now() - interval '30 days'
GROUP BY 1
ORDER BY 1;
```

### 近 30 天月活设备数

```sql
SELECT count(DISTINCT s.distinct_id)::int AS monthly_active_devices
FROM "session" s
JOIN website_event e
  ON e.session_id = s.session_id
 AND e.website_id = s.website_id
WHERE s.website_id = '<WEBSITE_ID>'
  AND e.url_path = '/app_launch'
  AND e.created_at >= now() - interval '30 days'
  AND s.distinct_id IS NOT NULL;
```

如需统计自然月，把时间条件改为：

```sql
e.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
```

### 使用场景分布

```sql
SELECT d.data_key,
       d.string_value,
       count(*)::int AS launches,
       count(DISTINCT s.distinct_id)::int AS devices
FROM website_event e
JOIN "session" s
  ON s.session_id = e.session_id
 AND s.website_id = e.website_id
JOIN event_data d
  ON d.website_event_id = e.event_id
 AND d.website_id = e.website_id
WHERE e.website_id = '<WEBSITE_ID>'
  AND e.url_path = '/app_launch'
  AND e.created_at >= now() - interval '30 days'
  AND d.data_key IN ('app_version', 'platform', 'arch', 'os_version', 'locale')
GROUP BY d.data_key, d.string_value
ORDER BY d.data_key, launches DESC;
```

## 运维

```bash
cd /srv/local-forwarder-umami
docker compose ps
docker compose logs --tail=100 umami
docker compose restart umami
docker compose exec -T database pg_dump -U umami umami > umami-backup.sql
```

升级 Umami 时先确认新镜像标签可用，再修改 `.env` 的 `UMAMI_IMAGE`，执行 `docker compose pull && docker compose up -d`，最后确认 `/api/heartbeat` 和后台登录正常。不要改成 MySQL 或 SQLite 镜像。

## 隐私边界

- 客户端只发送随机安装 UUID、版本、平台、架构、系统版本和语言。
- 请求使用固定的 `User-Agent: Mozilla/5.0 (compatible; LocalForwarder)`，不回传浏览器或系统原始 User-Agent，并避免被 Umami 的机器人过滤静默丢弃。
- 不发送账号、设备名、硬件指纹、配置、Token、代理地址，也不发送被调试请求的请求头、请求体或响应内容。
- 删除 `usage-install-id` 或重装应用会被视为新的安装设备。
- Umami 服务端仍会看到连接 IP；如启用 GeoIP 或边缘地区头，会记录粗粒度地区。自定义上报字段中不包含 IP 或原始 User-Agent。
