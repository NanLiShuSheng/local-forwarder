# Intel Mac 本地转发工具：工作计划与进度

更新时间：2026-08-19

## 项目目标

开发一个面向 Intel Mac 的 Electron 桌面本地转发工具，兼容参考工程 `/Users/hdw/Desktop/proxy` 的主要能力：HTTP/HTTPS 转发、TCP `/reqxml`、旧配置导入导出、本地变量、缓存和 `.d` 资源处理，并最终打包为 Intel x64 `.dmg`。

实现分支：`local-forwarder`

## 总体计划

1. Electron + TypeScript + React 工程骨架
2. 统一配置模型和旧配置兼容
3. 路由匹配、变量替换和日志脱敏
4. TZT 编解码和 TCP 长连接桥
5. HTTP/HTTPS 代理和特殊本地接口
6. 本地缓存和 `.d` 资源处理
7. 服务编排、状态和 IPC
8. 规则优先控制台界面
9. 端到端测试和 Electron 生命周期冒烟
10. Intel x64 打包、安装验证和最终审查

## 今日进度

### 已完成并通过审查

- 任务 1：Electron 工程骨架、安全策略、Preload/IPC 合约和构建脚本。
- 任务 2：统一配置模型、`config.js`/`config.json`/`sysconfig.ini` 兼容、原子保存、未知字段保留、VM/Worker 安全边界。
  - 已覆盖大小写归一化、数值账号字段、INI 段头、根级旧服务字段、字符串端口和历史 `/reqxml` 引号格式。
- 任务 3：规则最长匹配、变量替换、目标解析、对象和 query 脱敏。
  - 已覆盖禁用规则、确定性排序、三种 URL 编码占位符、默认端口、非法协议/端口/host、绝对/相对 URL query 和 fragment 边界。

### 任务 4 已完成并通过验证

- `src/core/tcp/tzt-codec.ts` 已改为调用随包的 legacy TZT runtime，覆盖真实 RC4、`jsonltzt`、`tztljson`、长数据和完整 GBK 映射；启动时执行固定字节自检，资产或 Node 16 runtime 不可用时明确报 `TZT codec runtime incompatible`。
- `resources/protocol/` 已纳入字节码、通用 GBK 映射和 helper，`electron-builder.yml` 显式复制到安装包的 `resources/protocol`，不包含用户配置。
- `src/core/tcp/tcp-bridge.ts` 已修复编码阻塞连接计时器、单请求超时后的迟到响应隔离、非法 magic、pending `close()` 和长连接复用。
- 测试已覆盖固定向量、中文/长数据、拆包/粘包、连接复用、连接失败、请求超时、迟到响应、非法帧和关闭清理。
- 全量构建与测试：`npm test` 通过，90/90；`git diff --check` 通过。

### 任务 5～10 的源码和打包产物已完成；应用启动安装验证仍受本机 GUI 环境阻塞

- 任务 5：`src/core/http/http-proxy.ts` 已实现 HTTP/HTTPS 转发、`$(KEY)`/`$(url)` 变量替换、gzip/deflate、二进制响应、413/502/504 和 `/reqlocal`、`/reqsavemap`、`/reqreadmap`、`/reqsavefile`、`/reqreadfile`、`/login`、`/reqxml`。
- 任务 6：`src/core/cache/file-cache.ts` 已实现路径穿越防护、并发下载锁、原子写入、失败清理以及 `.d` RC4/gzip 处理；HTTP 资源路径已实际接入缓存下载、命中和解码。
- 任务 7：`src/core/runtime/forwarding-service.ts` 已实现启动/停止/状态/配置/日志编排；Electron 主进程已接入真实 ConfigStore、ForwardingService 和白名单 IPC。
- 任务 8：renderer 已升级为规则优先控制台，包含运行状态、规则搜索/启停、变量掩码、缓存、日志过滤、设置和旧配置导入导出页面。
- 任务 9：已补充 HTTP、TCP、缓存、服务生命周期和 renderer 验收清单；`scripts/smoke-electron.mjs` 已检查 renderer 资源、`forwarder-ready` 和 status IPC。
- 任务 10：`electron-builder.yml` 已固定 DMG/x64 构建入口、`resources/protocol` 资源和 asar 文件范围；Electron 已移入 devDependencies。
- 当前验证：`npm test` 通过 99/99，`npm run build` 通过，`git diff --check` 通过；`npm install` 已补齐 Electron 43.4.0 x64 二进制。
- smoke 验证：`npm run smoke` 和 `FORWARDER_SMOKE_NO_SANDBOX=1 npm run smoke` 均因 Electron GUI 进程直接 `SIGABRT` 失败；最小 BrowserWindow 复现同样失败，故已定位为当前 Electron GUI 运行环境，不是应用 IPC 握手失败。
- 打包根因：Electron 缓存 ZIP 的 SHA-512 为 `6cdde2f6...`，与官方校验值 `7ab39ec1...` 不一致；electron-builder 默认解包阶段因此长期无产物。已固定 `electronDist: node_modules/electron/dist`，并改为先构建 `dir`、再用 macOS 原生 `hdiutil` 创建 DMG。
- 打包验证：`npm run package:x64` 已成功退出并生成 `release/Local Forwarder-0.1.0.dmg`；DMG 已通过 `hdiutil` CRC 校验、只读挂载、`app.asar`/`resources/protocol` 存在性检查和卸载。
- 安装包自动验证：`npm run verify:package` 已加入 `package:x64` 尾部，自动执行 DMG CRC 校验、只读挂载、应用包、`app.asar`、bundle identifier 和 TZT 协议资源检查，并自动卸载。
- 剩余环境阻塞：Electron GUI smoke 在当前环境直接 `SIGABRT`，因此从 DMG 安装后启动、HTTP/TCP 真实验收仍需在可运行 Electron GUI 的 Intel Mac 桌面会话完成；当前无 Developer ID 签名身份，产物为未签名 DMG。

## 明日优先事项

1. 在 Electron GUI 可正常启动的 Intel Mac 桌面会话运行 `npm run smoke`。
2. 从 `release/Local Forwarder-0.1.0.dmg` 安装并完成 HTTP/TCP/缓存和重启后配置验证；如需分发，再配置 Developer ID 签名和公证。

## 验证纪律

- 新功能先写失败测试，再实现最小代码。
- 每个任务完成后依次进行规格审查和代码质量审查。
- 不能把参考目录中的真实账号、手机号、Token 或完整用户配置复制进仓库。
- 只有在本轮实际运行并确认命令结果后，才能声明测试或构建通过。

## 当前工作区

- 分支：`local-forwarder`
- 当前 HEAD：任务 4 和任务 5～9 源码提交已落地；本轮打包脚本和 DMG 验证改动尚待提交。
- 参考目录未修改。
- 任务 10 只剩真实 Electron smoke、DMG 安装后启动和业务链路验证。
