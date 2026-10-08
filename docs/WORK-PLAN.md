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
- 旧版配置补充兼容：`config.js` 的 `path` 会按配置目录解析为项目目录并提供静态文件与 `.d` 资源读取；`_local` 生成的登录字段会并入本地变量缓存，界面显示缓存数量，登录响应中的 `ACTION=100` 或 `TOKEN` 更新会自动保存到内部配置。
- 旧版 `/reqxml` 补充兼容：按 `hq`、`jy`、`zx` 顺序提供转发地址配置；旧配置的 `useHttp: true` 下无协议地址按 HTTP 导入，`useHttp: false`（proxy3）继续走 TZT TCP；桌面端直接填写 `主机:端口` 默认按 TCP，HTTP/HTTPS 地址需保留协议前缀。
- 手动配置补充：变量页面支持直接粘贴多行 `键 = 值` 登录缓存并合并保存，值的续行内容（如 `ErrorMsg5`、`Grid`）会保留；设置页面支持通过 macOS 系统目录选择框选择 H5 项目目录，项目目录独占一行显示。
- 本地变量补充：操作面板新增独立的“本地变量”菜单和页面，按 `键 = 值` 解析并在离开输入框后自动合并保存；输入框原文通过 `localText` 持久化，应用重启后自动恢复；保存后不额外显示保存列表，长值在输入框内自动换行，便于继续修改；登录缓存单独保留在“登录缓存”菜单。
- 响应兼容补充：普通 HTTP、HTTP `/reqxml` 和 TCP `/reqxml` 的 JSON 顶层字段名统一转为大写，嵌套对象字段保持旧版浅层转换行为；二进制和 GBK 响应不转换。
- `/reqxml` 路由补充：未携带 `ReqLinkType` 时默认使用 `hq` 地址（2026-09-28 起与旧版 `proxy-ai 2` 行为一致）；显式 `ReqLinkType=0/1/2` 分别使用 `hq/jy/zx` 地址。
- 任务 9：已补充 HTTP、TCP、缓存、服务生命周期和 renderer 验收清单；`scripts/smoke-electron.mjs` 已检查 renderer 资源、`forwarder-ready` 和 status IPC。
- 任务 10：`electron-builder.yml` 已固定 DMG/x64 构建入口、`resources/protocol` 资源和 asar 文件范围；Electron 已移入 devDependencies。
- 当前验证：`npm test` 通过 120/120，`npm run build` 通过；已用 `/Users/hdw/Desktop/proxy 2` 做脱敏导入回归：项目目录解析正确，三组 `/reqxml` 地址和 74 项登录缓存可 round-trip 保留。
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

### 多代理实例并行转发（2026-08-28）

- 新增代理实例工作区持久化，旧版 `config.json` 首次启动时自动迁移为“默认代理”。
- 新增 `ForwardingServiceManager`，每个实例独立端口、配置、缓存、日志和运行状态；不同端口的多个实例可同时启动，端口冲突会在启动前拦截。
- 主进程和 Preload 新增实例列表、切换、新增、复制 IPC；概览页增加实例列表、端口/上游展示和单实例启停。
- 加密、手动请求、规则、变量、登录缓存和日志页面保留，并随当前选中实例切换；加密目录和加密任务继续保持全局。
- 本轮验证：`npm test` 通过 207/207，`npm run package:x64` 通过，DMG 校验通过，应用已安装到 `/Applications/Local Forwarder.app`。

### 主题设置（2026-09-01）

- 新增“外观”页面，支持跟随系统（默认）、浅色和深色主题；侧栏与主内容区同步切换，主题选择即时生效。
- 主题选择通过 `localStorage` 持久化，并监听 macOS `prefers-color-scheme` 变化，在跟随系统模式下即时响应系统主题变化。
- 主题控件保留清晰焦点样式，满足焦点可访问性和 AA 对比度保障。
- 已完成专项主题测试，以及运行时 hook 和媒体查询监听测试。
- 本轮验证：`npx tsx --test test/renderer/theme.test.ts`、`npx tsx --test test/renderer/chinese-ui.test.ts`、`npm test`、`npm run build` 和 `git diff --check` 均通过。

### Windows 10/11 x64 版本（2026-09-18）

- 保留 HTTP/HTTPS、TCP `/reqxml`、H5 加密、`.d` 解密、缓存和多代理实例能力。
- Windows x64 使用随包的 `resources/protocol/encode/h5encode-win-x86.exe` 子进程，以及官方 Node.js 16.13.0 x64 `node.exe` 运行 TZT 旧字节码；macOS 继续使用原有编码器和运行时路径。
- 端口 `8080–8089` 自动恢复在 Windows 使用 `netstat -ano -p tcp` 查询，先执行 `taskkill /PID <pid> /T`，超时后追加 `/F`；当前进程和非自动恢复端口保持跳过逻辑。
- Electron Builder 使用跨平台 appId `com.localforwarder.desktop`、NSIS x64 目标和 `resources/icon.ico`；安装包脚本为 `npm run package:win:x64`。
- Windows CI 位于 `.github/workflows/windows.yml`，执行 `npm ci`、`npm test`、`npm run build`、NSIS 打包、包校验和 packaged smoke，并上传安装器与 `dist/win-unpacked`。
- Windows 验收命令：`npm run package:win:x64`、`npm run verify:win`、`node scripts/smoke-packaged.mjs`；需在 Windows x64 runner 完成真实安装、HTTP/HTTPS、TCP/TZT、H5 加密、`.d` 解密、端口恢复和卸载后用户数据保留验证。

### GitHub Releases 自动更新（2026-09-22）

- 主进程通过 `electron-updater` 提供手动检查、下载进度和安装前停止代理；renderer 使用持久更新卡片，普通错误继续使用短时 Toast。
- Release Tag 必须与 `package.json.version` 匹配，Windows NSIS 与 macOS DMG/ZIP 资产会在发布前校验版本、更新元数据和 `sha512`。
- `.github/workflows/release.yml` 仅对 `v*` Tag 构建 Windows x64 和 Intel macOS x64，两个构建 job 成功后由 publish job 创建 GitHub Release。
- macOS Actions 需要配置 `MACOS_CERTIFICATE_BASE64`、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；本地构建跳过签名环境检查和公证。
- 已完成 renderer、发布脚本和 workflow 契约测试；真实 Windows runner、Apple Developer ID 签名/公证以及两版本自动更新验收需在对应外部环境执行。

### SSE 流式转发与 ReqLinkType 默认值（2026-09-28）

- 移植旧版 `/reqsse` 路径与 `tztforward: forward` 请求头：`TcpBridgePool` 新增 `requestStream`，流式请求在同一长连接上按帧回调，空闲超时每帧重置，`cancel()` 与连接失败可终止流。
- HTTP 层按旧版行为输出 `text/event-stream`：`GRID0`/`Grid0` 提取、数组 `\r\n` 拼接、`"0"` 终止哨兵、无 GRID0 帧以大写键 JSON 写出、`tztcontenttype: application/octet-stream` 时 `zzkeyByte.Grid0` 转 base64；仅支持 TCP 类型转发地址，HTTP transport 目标返回 502。
- 客户端断开连接时自动取消流，避免旧版 `res_s` 悬挂泄漏。
- `/reqxml` 与 `/reqsse` 未携带 `ReqLinkType` 时默认值由 1（jy）改为 0（hq），与旧版 `proxy-ai 2` 行为一致；`/login` 仍固定 `REQLINKTYPE=1`。

### 转发地址默认配置与保存/删除操作（2026-09-28）

- 默认配置预填旧版三个转发地址：hq `123.60.102.92:7778`、jy `123.103.83.98:17772`、zx `123.103.83.98:17772`（TCP）；本机现有实例已同步补齐。
- 移除转发地址的"启用"开关：`tcpTargets[].enabled` 从类型、校验、导入导出和运行时中移除（旧配置文件里的 `enabled` 字段按未知字段保留但不再生效）；`/reqxml`、`/reqsse` 直接按位置索引地址，`ReqLinkType=0/1/2` 固定对应 hq/jy/zx，不再因禁用产生索引漂移。
- 地址行改为显式操作：每行提供"保存"（校验并持久化、记入历史下拉）和"删除"（移除该行、下方行上移）按钮，移除 onBlur 自动保存和历史选中即保存。
- 转发规则（httpRules）的启用/停用不受影响。

### 转发地址页接入 Ant Design（2026-09-28）

- 引入 `antd`（React 生态等价物；Element Plus 为 Vue 专用不可用），`App.tsx` 以 `ConfigProvider` 接入中文语言包并跟随应用深浅色主题切换 antd 算法。
- 转发地址输入改为 `AutoComplete`：历史地址直接作为下拉选项，输入即筛选，选中回填；每项历史带"×"删除按钮，删除的是历史记录下拉中的条目（`forwardingAddressHistory`），不再提供清空当前地址行的操作。
- 地址行操作只保留"保存"（`Button type="primary"`）：校验并写入对应槽位 + 记入历史下拉。
- 地址输入保留 `address-input` 主题变量外壳（antd 内部 selector 透明化），既有主题契约测试不受影响；加密页自研下拉保持不变。

### 概览页浏览器直达与运行中地址热保存（2026-09-28）

- 概览页新增"页面地址"输入框（默认/占位 `/dist/src/ai-assistant/index.html#/index`）和"在浏览器打开"按钮：输入完整 http(s) 地址原样打开，输入路径自动拼接当前实例监听地址；输入值持久化到实例配置 `launchPath` 字段。
- 新增 `app:open-external` IPC 通道，主进程校验仅允许 http/https 协议后调用 `shell.openExternal`。
- 运行中保存配置的拦截改为字段级放行：仅变更 `tcpTargets`、`forwardingAddressHistory`、`launchPath`（及运行时自有的 localValues/mapValues/legacy）时允许保存，其中 `tcpTargets` 通过 `HttpProxy.updateOptions` 即时热应用到运行中的代理；端口、主机等其他字段仍需先停止代理。

### 登录缓存改为进页拉取（2026-09-29）

- 移除 2 秒轮询中对 `getLoginCache` 的调用：轮询返回新对象引用会触发文本框同步 effect，导致"登录缓存"页正在编辑的内容每 2 秒被服务端存储值冲掉。
- 改为进入"登录缓存"页时通过 `getLoginCache` 拉取一次；本地变量页保持不变。

### 运行时缓存写入即时落盘（2026-09-29）

- 修复 `/reqsavemap`、`/reqsavefile` 写入只停留在内存、不落盘的问题：`HttpProxy` 新增 `onValuesWritten` 回调，`ForwardingService` 收到后把运行中代理持有的 localValues/mapValues/legacy.files 同步进配置并经保存队列落盘，与旧版"写 config.json 即落盘"行为对齐。
- `stopInternal` 停止代理前同样同步落盘一次，停止/退出不再丢失运行期写入。
- `persistLocalValues` 复用同一同步逻辑，登录捕获落盘时顺带带上最新的 mapValues/legacy.files。

### 变量页实时推送与合并显示（2026-09-29）

- 新增 `values:changed` IPC 推送：`saveSharedValues`、`saveLoginCache`、`mergeLoginCache`（登录捕获）变更后由主进程主动推送最新 sharedValues + 当前实例 loginCache，渲染层订阅更新，不再依赖轮询。
- "本地变量"页改为显示合并后的生效变量（sharedValues + loginCache，loginCache 同名优先）；保存时自动剥离与登录缓存一致的条目，只把手动维护的键写回 sharedValues。
- 两个变量文本框加编辑保护：聚焦编辑期间忽略外部同步，失焦保存成功后恢复；保存失败保留原文。

### 修复代理运行时登录捕获链路断裂（2026-09-29）

- `ForwardingServiceManager` 默认 serviceFactory 丢弃了 `createService` 传入的 `onLoginValuesChanged` 回调，导致真实 app 中代理运行时的登录捕获（ACTION=100/TOKEN）无法进入 loginCache——不落盘、不推送。已修复为透传该回调；手动请求页的捕获路径（main.ts 直连 mergeLoginCache）此前正常、不受影响。
- 新增不注入 factory 的集成测试：真实 ForwardingService + 本地桩上游，验证捕获进入 loginCache 并触发 `onValuesChanged` 推送。

### 本地变量页纳入文件/映射存储（2026-09-29）

- `values:changed` 推送负载扩展为 `{ sharedValues, loginCache, mapValues, fileValues }`；`HttpProxy.onValuesWritten`（`/reqsavefile`、`/reqsavemap` 写入）经 ForwardingService 上报给 manager 并触发同一推送——H5 端 `T.saveFileMesg` 等写入后本地变量页立即可见。
- 本地变量页合并显示 `sharedValues + mapValues + fileValues + loginCache`（后者优先）；保存时剥离与三个只读存储一致的条目，仅手动键写回 sharedValues。

### 本地变量页三段拆分（2026-09-29）

- 本地变量页由合并视图改为三个独立小节：`local · 本地缓存（客户端读取）`（可编辑，存 sharedValues）、`login · 登录缓存（登录后捕获）`（只读）、`h5 · H5 写入缓存`（只读，mapValues + fileValues，即 saveFileMesg/saveMapMesg 写入的数据）；后两段随 `values:changed` 推送实时更新。
- 拆分后各段与存储一一对应，保存不再需要剥离逻辑，`stripStoredEntries` 随之移除。

### 本地变量页三段全可编辑、修改即保存（2026-09-29）

- 三段顺序调整为 h5 → login → local，全部由只读/失焦保存改为可编辑 + 每次修改即保存（解析失败的输入中间态静默跳过，不刷错误提示）；编辑保护改为聚焦期间忽略外部推送、失焦即恢复。
- h5 段保存经 `splitH5StoreEntries` 路由回原存储：原属 mapValues 的键写回 mapValues，其余（含新增）写回 fileValues，删除的键从对应存储移除。
- 新增 `values:stored:save` IPC 与 `ForwardingService.setStoredValues`/`HttpProxy.updateOptions` 扩展：h5 段保存即时更新运行中代理的 live mapValues/fileValues（`/reqreadmap`、`/reqreadfile` 立刻读到新值）并落盘，不要求停止代理。

### 界面细节调整（2026-09-29）

- 日志列表行固定 34px 高度、不垂直居中，消息单行省略（此前长日志会撑高行）。
- 本地变量页 local 段去掉 `min-height: 420px` 并降为 `rows={6}`，按内容紧凑显示。
- 概览页代理名称在代理运行中也可修改（其余运行参数仍需停止后修改）。
- 侧边栏实例卡片端口下方新增"在浏览器打开"按钮：用该实例自己的 `bindHost:port` + `launchPath`（`ProxyInstanceSummary` 新增该字段）打开系统默认浏览器。

### 日志列表紧凑化与卡片按钮调整（2026-09-29）

- 日志列表去掉行间距（`.log-list` gap 归 0），行与行紧密排列成连续列表，消除行间的空白带。
- 侧边栏卡片的浏览器按钮改为卡片内的实体小按钮，文案简化为"打开"。

### 侧边栏卡片打开按钮移除（2026-09-29）

- 经样式试调后决定移除侧边栏卡片的"打开"按钮（含 `ProxyInstanceSummary.launchPath` 字段），标题行与地址行间距固定为 8px；浏览器打开入口保留在概览页。
- 新增代理实例时复制列表第一个实例的转发地址（`tcpTargets`），不再使用内置默认值；地址显示前缀维持现状（tcp:// 不动）。
- 默认监听主机曾改为 `localhost`，实测本机 Node 会将其绑到 IPv6 `::1` 导致 `127.0.0.1` 直连被拒，已回退保持 `127.0.0.1`（客户端用 localhost 访问不受影响）。
- 转发地址改为修改即保存：输入或下拉选择合法地址后立即持久化并热应用，输入中间态静默跳过；移除每行的"保存"按钮；图钉钉选行为不变。

### 地址保存与热应用分离、钉选默认 zx、arm64 打包（2026-09-29）

- 转发地址恢复每行"保存"按钮：仅负责写入配置文件并记入历史下拉；输入框编辑和历史下拉选择改为经新增的 `runtime:apply-targets` IPC 即时热应用到运行中的代理（`ForwardingService.applyTcpTargets`，只改 live 值不落盘），输入中间态静默跳过。
- 新增代理实例时同时复制第一个实例的 `forwardingAddressHistory`（历史下拉随地址一起带过去）。
- 卡片钉选未手动选择时默认显示 zx 地址；钉选值按实例独立保存。
- 新增 macOS arm64（M 系列）打包：`electron-builder --mac dir --arm64` + `create-dmg.mjs`（新增可选的 app 路径与输出名参数），产物 `release/Local Forwarder-0.1.0-arm64.dmg`，未签名。
- 修复"选择项目目录/加密目录点击无反应"：`dialog.showOpenDialog` 未挂载父窗口导致对话框可能出现在应用窗口后方，现统一通过 `showOpenDialogInMainWindow` 挂到主窗口弹出。
- TZT 帧长上限由 1MB 提升到 64MB（tcp-bridge 与 tzt-codec 两处）：修复大响应（资讯大字段、文件 BINDATA 等约 1.5MB 帧）被误判 `Invalid TZT frame length` 并断开连接的问题，补了大于 1MB 帧可通过的回归测试；打包版起不了代理的根因是缺随包 Node16 运行时，已随包携带 `resources/protocol/node/darwin-arm64/node` 并实测打包应用启动代理成功。
