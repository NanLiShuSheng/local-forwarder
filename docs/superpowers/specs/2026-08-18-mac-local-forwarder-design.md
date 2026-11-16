# Intel Mac 本地转发工具设计规格

## 目标

构建一个面向 Intel Mac 的 Electron 桌面工具，用图形界面管理并运行本地转发服务。首版需要覆盖参考工程 `/Users/hdw/Desktop/proxy` 的主要能力：HTTP/HTTPS 按 URL 规则转发、`/reqxml` TCP 长连接转发、本地变量接口、远程静态资源缓存，以及 `.d` 文件的 RC4 解密和 gzip 处理。

## 已确认范围

- 主界面采用“规则优先”布局：左侧规则列表，右侧运行状态和底部日志。
- 同时支持 HTTP/HTTPS 转发和 TCP `/reqxml` 转发。
- 兼容导入 `config.js`、`config.json`、`sysconfig.ini`，并提供图形化编辑和导出。
- 保留远程静态资源下载、本地缓存、`.d` 文件 RC4 解密和 gzip 处理。
- 桌面技术采用 Electron + Node.js；转发核心在 Electron 主进程内模块化运行，不以独立子进程承载旧入口。
- 首版打包目标为 macOS Intel x64 `.dmg`。

## 架构

### Electron 层

- `main` 管理 BrowserWindow、应用生命周期、启动/停止转发服务和系统级错误。
- `preload` 通过 `contextBridge` 暴露最小化的 IPC API。
- `renderer` 使用 React/Vite 实现界面，不直接访问文件系统、网络或 Node 模块。

### 转发核心

核心在主进程中分为四个边界清晰的模块：

1. `config`：读取旧格式，转换为统一内部模型，校验后保存到 macOS 应用数据目录；原始配置只读导入，不被自动覆盖。
2. `http-proxy`：监听本地 HTTP 服务，按路径规则选择目标，执行 `$(KEY)` 本地变量替换，转发 HTTP/HTTPS 请求，处理请求超时和响应解压。
3. `tcp-bridge`：为每个目标 `host:port` 管理 TCP 长连接，复用参考工程的帧编解码逻辑，用序列号将响应关联到原始 HTTP 请求；连接异常时清理挂起请求并按策略重连。
4. `cache`：本地文件命中时直接返回；未命中时从下载目标获取并安全写入缓存；对 `.d` 资源执行 RC4 解密，并对指定脚本资源执行 gzip 解压。

## 内部配置模型

配置模型至少包含：

- `server`: `bindHost`、`port`、`timeoutMs`、`loggingEnabled`
- `httpRules`: `id`、`name`、`match`、`target`、`rewrite`、`enabled`
- `tcpTargets`: `id`、`name`、`host`、`port`、`enabled`
- `localValues`: 大小写不敏感的键值表，用于请求变量替换和 `/reqlocal`
- `mapValues`: 读写映射，对应 `/reqreadmap` 和 `/reqsavemap`
- `accounts`: 按业务类型保存旧配置中的账号字段；敏感值在界面中默认掩码
- `cache`: `rootDir`、下载目标、解密配置和自动下载开关

旧格式适配规则：

- `config.js` 中的 `conifg` 转换为 HTTP/TCP 规则和服务设置。
- `config.js` 中的 `local`、`map`、`account` 分别转换为本地变量、映射和账号数据。
- `config.json` 按文件名键保留为缓存/本地文件数据。
- `sysconfig.ini` 按 `key=value` 解析；重复键以最后一次出现的值为准。
- 导入时保留未知字段，导出时可选择生成兼容旧格式或内部 JSON 格式。

## 请求与响应流程

```text
本地客户端
  -> HTTP Server
  -> 特殊本地接口或 URL 规则匹配
  -> HTTP/HTTPS 目标，或 /reqxml TCP Bridge
  -> 变量替换、解压、缓存和响应整理
  -> 本地客户端
```

特殊本地接口首版保留：

- `/reqlocal`
- `/reqsavemap`、`/reqreadmap`
- `/reqsavefile`、`/reqreadfile`
- `/login`
- `/reqxml`

HTTP/HTTPS 响应只在内容类型和编码满足条件时进行 JSON 规范化；二进制内容不强制转 JSON。响应头中的 `content-encoding` 和过期的 `content-length` 在解压或改写后重新处理。

## 界面设计

- “运行”页面：启动/停止按钮、监听地址/端口、服务状态、请求量、成功率、平均延迟、TCP 连接数。
- “规则”页面：规则列表、启停开关、匹配路径、目标协议/地址/端口、变量替换预览、端口冲突和配置校验提示。
- “本地变量”页面：搜索、编辑、导入/导出、敏感值掩码。
- “缓存”页面：缓存目录、命中率、清理单条/全部缓存、下载失败详情。
- “日志”页面：按级别和规则过滤，展示时间、方向、协议、状态、耗时和错误原因。
- “设置”页面：导入旧配置、导出配置、默认端口、超时、日志级别和启动行为。

## 安全和可靠性约束

- 默认只绑定 `127.0.0.1`，除非用户主动修改绑定地址。
- Renderer 使用 `contextIsolation`，禁止 Node 集成；IPC 只允许白名单命令和结构化数据。
- 缓存路径必须经过规范化和根目录校验，拒绝 `..` 穿越。
- 日志默认过滤密码、Token、手机号和账号字段；完整请求体不默认落盘。
- 配置错误、端口占用、目标超时、TCP 断开和缓存损坏都必须显示可操作的错误信息。
- 启动失败时不得留下部分运行中的监听器或挂起的 TCP 连接。

## 测试范围

- 配置：三种旧格式解析、大小写归一化、未知字段保留、敏感字段掩码、导入导出往返。
- 规则：路径匹配、目标解析、`$(KEY)` 替换、特殊接口路由、禁用规则和端口校验。
- HTTP：GET/POST、请求头、响应状态、gzip/deflate、二进制响应、超时和目标失败。
- TCP：帧编解码、拆包/粘包、序列号响应关联、长连接复用、断线清理和重连。
- 缓存：命中/未命中、并发下载、`.d` 解密、gzip 资源、损坏文件、路径穿越防护。
- Electron：启动/停止生命周期、IPC 白名单、端口冲突提示和 renderer 不可直接访问 Node。
- 打包：Intel x64 `.dmg` 安装后启动、读取应用数据目录、启动本地 HTTP 服务和卸载后数据保留策略。

## 明确不纳入首版

- ARM64 原生构建。
- 远程配置同步、多用户权限和云端日志。
- 全局系统代理/PAC 自动配置。
- 复杂流量图表和请求体永久存档。

