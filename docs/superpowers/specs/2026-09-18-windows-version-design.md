# Windows x64 版本设计规格

## 目标

为 Local Forwarder 增加 Windows 10/11 x64 安装版，保留现有 HTTP/HTTPS 转发、TCP `/reqxml`、`.d` 资源处理、H5 目录加密、配置持久化和多代理实例能力。Windows 版使用 NSIS 安装包，并能在干净的 Windows x64 环境中运行，不要求用户额外安装 Node.js。

## 范围与约束

- 首版目标平台为 Windows 10/11 x64。
- Windows H5 编码器使用用户提供的 `h5encode.exe`。该文件是 PE32/i386 32 位程序，Windows x64 通过 WOW64 运行；首版不承诺 Windows ARM64 或原生 x64 编码器。
- 现有 TZT bytecode 依赖 Node.js 16.13.0。Windows 安装包必须包含 Windows x64 的 Node 16.13.0 `node.exe`，放在 `resources/protocol/node/win-x64/node.exe`，开发环境仍允许通过 `TZT_NODE16_BIN` 覆盖路径。
- macOS DMG 链路继续保留；平台资源选择不能把 Windows 资源带入 macOS 执行路径。
- Windows 安装包在 Windows runner 或真实 Windows 主机上构建和验收。当前 `electronDist: node_modules/electron/dist` 使用构建机对应的 Electron 运行时，不把 Mac 上的 Electron 目录作为 Windows 交叉构建产物。
- 首版不包含自动更新、Windows ARM64、编码器算法重编译和新的业务协议。

## 现有代码中的接入点

- `electron/paths.ts` 负责 renderer、preload 和 H5 编码器路径解析，将扩展为平台/架构资源解析入口。
- `electron/main.ts` 继续通过 `getEncryptionEncoderPath()` 将编码器路径传给 `encryptDirectory()`，不让 renderer 直接访问本地可执行文件。
- `src/core/encryption/encryptor.ts` 保持“复制输入文件、执行编码器、读取同目录 `.d` 输出、清理临时目录”的协议；Windows 编码器必须遵守相同的单文件参数和 `<input>.d` 输出约定。
- `src/core/tcp/tzt-codec.ts` 的协议目录发现逻辑继续优先使用打包资源，并新增 Windows x64 随包 Node 运行时候选路径。
- `src/core/runtime/port-recovery.ts` 抽象端口查询和进程终止实现，保留现有 8080–8089 自动恢复范围。
- `electron-builder.yml` 保留已有 `extraResources`，新增 Windows `nsis` 目标和 Windows 图标配置。

## 资源布局

安装包中的资源布局如下：

```text
resources/
└── protocol/
    ├── encode/
    │   ├── h5encode-mac-amd64
    │   └── h5encode-win-x86.exe
    ├── node/
    │   └── win-x64/
    │       └── node.exe
    ├── tzt-node16-helper.js
    ├── tzt.bytecode-16.13.0
    └── ...existing protocol assets...
```

开发环境和打包环境使用同一套相对资源布局。Windows 运行时只选择 `h5encode-win-x86.exe` 和 `node/win-x64/node.exe`；macOS 仍只选择 `h5encode-mac-amd64`。

## 平台路径与编码器解析

`getEncryptionEncoderPath()` 增加可测试的平台/架构选择逻辑：

- `darwin/x64` 解析到 `protocol/encode/h5encode-mac-amd64`。
- `win32/x64` 解析到 `protocol/encode/h5encode-win-x86.exe`。
- 未支持的平台或架构直接抛出包含平台和架构的错误，不静默使用其他平台的二进制。

`src/core/encryption/encryptor.ts` 在执行前继续验证文件存在性；Windows 错误信息必须包含实际编码器路径和子进程输出，便于定位打包遗漏或权限问题。

## TZT 运行时解析

`node16Binary()` 的候选顺序调整为：

1. `TZT_NODE16_BIN` 环境变量；
2. Windows 打包资源 `process.resourcesPath/protocol/node/win-x64/node.exe`；
3. 开发目录的 `resources/protocol/node/win-x64/node.exe`；
4. 当前平台已有的外部 Node 16 路径。

只有通过可执行检查的候选才可使用。所有候选失败时，错误必须明确说明 Node.js 16.13.0、资源路径和 `TZT_NODE16_BIN` 覆盖方式。这样 TCP `/reqxml` 和 `.d` 解密不会错误地尝试使用 Electron 自带的其他 Node/V8 版本。

## Windows 端口冲突恢复

端口恢复继续只对 8080–8089 生效，并通过依赖注入保持单元测试可控：

- macOS 继续使用 `lsof` 查询监听 PID，并使用现有 TERM/KILL 两阶段流程。
- Windows 使用 `netstat -ano -p tcp` 查询 `LISTENING` 状态和 PID。
- Windows 第一阶段执行 `taskkill /PID <pid> /T`，第二阶段执行 `taskkill /PID <pid> /T /F`，每阶段都轮询端口释放状态。
- 当前进程 PID 永远跳过；进程不存在视为已释放；命令失败或端口仍被占用时返回明确错误。
- 非 8080–8089 端口不执行自动终止，保持现有端口冲突错误行为。

## 打包与发布

### 配置

- `appId` 改为跨平台的 `com.localforwarder.desktop`。
- npm 包名称和描述去除 `mac`、`Intel Mac` 限定。
- `electron-builder.yml` 增加 `win.target: nsis`、Windows 图标和必要的资源校验入口。
- 新增 `resources/icon.ico`。
- 新增 `package:win:x64`，在 Windows x64 环境执行构建和 NSIS 打包。
- macOS 命令继续使用现有 `package:x64`，其 DMG 创建和校验不改为 Windows 逻辑。

### 校验

新增 Windows 包校验脚本，检查：

- `dist/win-unpacked/Local Forwarder.exe` 和 NSIS 安装包存在且非空；
- `resources/protocol`、TZT bytecode、Windows 编码器和 Node 16 运行时存在；
- Windows 包内的应用标识和版本信息正确；
- Windows 编码器为 PE 文件，Node 运行时为 Windows x64 可执行文件。

真实 Windows 验收还需从 `win-unpacked` 启动 `--smoke`，完成 renderer 加载、status IPC、HTTP/HTTPS 转发、TCP `/reqxml`、H5 加密和重启配置读取检查。

## 测试策略

- 将 npm 测试入口改为 Node 脚本递归发现 `test/**/*.test.ts`，移除 `$(rg ...)` 等 POSIX shell 语法。
- 加密测试不依赖 Unix `.sh` 和 chmod；通过 Node 当前运行时启动跨平台测试编码器，仍验证输入复制、`.d` 输出、增量处理、错误捕获和临时目录清理。
- 路径测试覆盖 macOS x64、Windows x64、未支持平台和未支持架构。
- 端口恢复测试覆盖 Windows `netstat` 输出解析、PID 去重、当前进程跳过、普通/强制终止和命令失败。
- 包合约测试分别验证 DMG 和 Windows 资源，不再让 Windows 测试读取 `verify-dmg.mjs`。
- macOS 环境运行 `npm test`、`npm run build` 和现有 DMG 校验；Windows runner 运行 `npm test`、`npm run build`、`npm run package:win:x64`、Windows 包校验和 packaged smoke。

## 错误处理与降级边界

- 缺少 Windows 编码器时，加密操作返回包含实际路径的错误；不回退到 macOS 编码器。
- 缺少随包 Node 16 运行时时，使用 TZT 的请求返回明确的兼容性错误；不使用 Electron Node 运行时加载旧 bytecode。
- Windows 端口查询工具不可用时，启动失败并提示端口占用/恢复失败，不静默认为端口已释放。
- 构建校验缺少任一原生资源时退出非零，阻止生成可发布的“功能不完整”安装包。

## 验收标准

Windows 10/11 x64 上安装 NSIS 包后：

1. 应用能启动，配置写入 Windows `app.getPath("userData")` 并在重启后恢复。
2. HTTP/HTTPS 规则转发和多代理实例正常。
3. TCP `/reqxml` 使用随包 Node 16.13.0 正常编解码。
4. H5 目录加密调用 Windows 编码器并生成可读取的 `.d` 文件。
5. `.d` 缓存解密正常。
6. 8080–8089 端口冲突能按 Windows 适配逻辑恢复或给出明确错误。
7. 安装包校验和 packaged smoke 通过。

