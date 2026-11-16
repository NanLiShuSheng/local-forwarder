# Intel Mac 本地转发工具实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建一个可打包为 Intel x64 `.dmg` 的 Electron Mac 本地转发工具，兼容参考 proxy 的 HTTP/HTTPS、TCP `/reqxml`、旧配置、缓存和 `.d` 资源处理能力。

**架构：** Electron 主进程运行模块化转发核心，Preload 只暴露白名单 IPC，React renderer 实现规则优先控制台。核心按配置、路由、HTTP、TCP、协议编解码、缓存和服务编排拆分；旧配置只读导入后转换为统一内部模型，运行数据保存到 macOS 应用数据目录。

**技术栈：** Electron、TypeScript、React、Vite、Node `http`/`https`/`net`/`zlib`、`node:test`、`tsx`、electron-builder。

---

## 文件结构

### 工程入口和构建

- 创建：`package.json` — 依赖、开发、测试和 Intel x64 打包脚本。
- 创建：`tsconfig.json`、`tsconfig.node.json` — renderer 与 Electron/core 的 TypeScript 配置。
- 创建：`vite.config.ts` — React renderer 构建配置。
- 创建：`electron-builder.yml` — macOS Intel x64 `.dmg` 配置和资源打包规则。
- 创建：`electron/main.ts` — BrowserWindow、应用数据目录、服务生命周期和 IPC 注册。
- 创建：`electron/preload.ts` — contextBridge API。
- 创建：`src/shared/contracts.ts` — 主进程、Preload、renderer 共用的类型和 IPC 合约。

### 转发核心

- 创建：`src/core/config/model.ts` — 统一配置模型和默认值。
- 创建：`src/core/config/legacy-parser.ts` — `config.js`、`config.json`、`sysconfig.ini` 导入适配。
- 创建：`src/core/config/config-store.ts` — 配置校验、应用数据目录读写、兼容格式导出。
- 创建：`src/core/routing/rule-matcher.ts` — URL 规则匹配、目标解析和变量替换。
- 创建：`src/core/http/http-proxy.ts` — HTTP 服务、HTTP/HTTPS 转发和响应整理。
- 创建：`src/core/tcp/tzt-codec.ts` — 参考工程 TZT 编解码器的 Electron 运行时适配。
- 创建：`src/core/tcp/tcp-bridge.ts` — TCP 长连接池、序列号关联、拆包粘包和重连。
- 创建：`src/core/cache/file-cache.ts` — 安全缓存路径、远程下载和 `.d` 解码。
- 创建：`src/core/runtime/forwarding-service.ts` — 统一启动/停止、状态、日志和资源清理。
- 创建：`src/core/runtime/redact.ts` — 日志敏感字段过滤。

### 界面

- 创建：`src/renderer/index.html` — Vite HTML 入口。
- 创建：`src/renderer/main.tsx` — React 挂载入口。
- 创建：`src/renderer/App.tsx` — 规则优先主布局和页面切换。
- 创建：`src/renderer/styles.css` — macOS 风格浅色控制台样式。
- 创建：`src/renderer/components/RuleList.tsx` — 左侧规则列表。
- 创建：`src/renderer/components/RuntimePanel.tsx` — 运行状态、启动/停止和统计。
- 创建：`src/renderer/components/LogPanel.tsx` — 日志展示和过滤。
- 创建：`src/renderer/components/ConfigPages.tsx` — 本地变量、缓存、设置和导入导出页面。

### 测试和夹具

- 创建：`test/fixtures/legacy/config.js`、`config.json`、`sysconfig.ini` — 脱敏旧格式样例。
- 创建：`test/core/config/legacy-parser.test.ts`、`config-store.test.ts`。
- 创建：`test/core/routing/rule-matcher.test.ts`。
- 创建：`test/core/http/http-proxy.test.ts`。
- 创建：`test/core/tcp/tzt-codec.test.ts`、`tcp-bridge.test.ts`。
- 创建：`test/core/cache/file-cache.test.ts`。
- 创建：`test/core/runtime/forwarding-service.test.ts`。
- 创建：`test/electron/ipc-contract.test.ts`。
- 创建：`scripts/smoke-electron.mjs` — 打包前 Electron 生命周期冒烟检查。

参考目录中的真实 `config.js`、`config.json`、账号、Token 和手机号不得复制到仓库；测试只使用上述脱敏夹具。

## 任务 1：建立 Electron + TypeScript + React 工程骨架

**文件：**
- 创建：`package.json`、`tsconfig.json`、`tsconfig.node.json`、`vite.config.ts`
- 创建：`electron/main.ts`、`electron/preload.ts`
- 创建：`src/shared/contracts.ts`
- 创建：`src/renderer/index.html`、`src/renderer/main.tsx`、`src/renderer/App.tsx`、`src/renderer/styles.css`
- 测试：`test/electron/ipc-contract.test.ts`

- [ ] **步骤 1：写入最小 IPC 合约测试**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { IPC_CHANNELS, type RuntimeStatus } from "../../src/shared/contracts";

test("IPC channels expose stable runtime commands", () => {
  assert.deepEqual(IPC_CHANNELS, {
    getConfig: "config:get",
    saveConfig: "config:save",
    importLegacy: "config:import-legacy",
    exportConfig: "config:export",
    start: "runtime:start",
    stop: "runtime:stop",
    status: "runtime:status",
    logs: "runtime:logs",
  });
  const status: RuntimeStatus = { state: "stopped", requestCount: 0, tcpConnections: 0 };
  assert.equal(status.state, "stopped");
});
```

- [ ] **步骤 2：运行测试确认骨架尚未实现**

运行：`npx tsx --test test/electron/ipc-contract.test.ts`

预期：FAIL，报错 `Cannot find module '../../src/shared/contracts'`。

- [ ] **步骤 3：创建项目配置和共享合约**

`package.json` 至少包含以下脚本和依赖入口：

```json
{
  "name": "local-forwarder-mac",
  "version": "0.1.0",
  "private": true,
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "concurrently -k \"vite --config vite.config.ts\" \"wait-on http://localhost:5173 && electron .\"",
    "build": "tsc -p tsconfig.node.json && vite build",
    "test": "tsx --test test/**/*.test.ts",
    "package:x64": "npm run build && electron-builder --mac dmg --x64",
    "smoke": "node scripts/smoke-electron.mjs"
  },
  "dependencies": { "@vitejs/plugin-react": "latest", "electron": "latest", "react": "latest", "react-dom": "latest" },
  "devDependencies": { "concurrently": "latest", "electron-builder": "latest", "tsx": "latest", "typescript": "latest", "vite": "latest", "wait-on": "latest" }
}
```

`src/shared/contracts.ts` 定义 `AppConfig`、`ForwardRule`、`LogEntry`、`RuntimeStatus` 以及上面测试中的 `IPC_CHANNELS` 常量。`RuntimeStatus.state` 只允许 `stopped | starting | running | stopping | error`。

- [ ] **步骤 4：实现 Electron 最小窗口和 Preload 白名单**

`electron/preload.ts` 只通过 `contextBridge.exposeInMainWorld("forwarder", api)` 暴露结构化方法；`electron/main.ts` 使用 `contextIsolation: true`、`nodeIntegration: false`，创建 1200×760 的窗口并加载 Vite dev URL 或构建后的 `index.html`。

- [ ] **步骤 5：实现最小 React 页面并运行测试**

`App.tsx` 先渲染 `Local Forwarder` 标题和 `stopped` 状态，确保 renderer 可以在不访问 Node 的情况下调用 `window.forwarder.status()`。

运行：`npx tsx --test test/electron/ipc-contract.test.ts`

预期：PASS。

- [ ] **步骤 6：提交工程骨架**

```bash
git add package.json tsconfig.json tsconfig.node.json vite.config.ts electron src/shared src/renderer test/electron
git commit -m "feat: bootstrap Electron local forwarder"
```

## 任务 2：实现统一配置模型和旧配置导入导出

**文件：**
- 创建：`src/core/config/model.ts`、`src/core/config/legacy-parser.ts`、`src/core/config/config-store.ts`
- 创建：`test/fixtures/legacy/config.js`、`config.json`、`sysconfig.ini`
- 测试：`test/core/config/legacy-parser.test.ts`、`config-store.test.ts`

- [ ] **步骤 1：编写失败测试，覆盖三种旧格式和敏感字段**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { importLegacyConfig } from "../../../src/core/config/legacy-parser";

test("imports legacy config and normalizes keys case-insensitively", async () => {
  const config = await importLegacyConfig("test/fixtures/legacy");
  assert.equal(config.server.port, 83);
  assert.equal(config.localValues.TOKEN, "fixture-token");
  assert.equal(config.httpRules[0].match, "/qdymanage");
  assert.equal(config.tcpTargets[0].host, "127.0.0.1");
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/config/legacy-parser.test.ts`

预期：FAIL，报错 `Cannot find module '../../../src/core/config/legacy-parser'`。

- [ ] **步骤 3：实现内部模型和解析器**

`model.ts` 提供 `createDefaultConfig()`；`legacy-parser.ts` 提供 `parseSysConfig(text)`、`parseLegacyConfigJs(text)`、`parseLegacyJson(text)` 和 `importLegacyConfig(directory)`。`config.js` 只在 `vm` 沙箱中执行，沙箱禁用 `require`、设置 500ms 超时，并只读取 `module.exports`；未知字段写入 `legacy.extra`，不执行外部命令或网络请求。

规则转换必须把 `conifg["/reqxml"].target` 的有效 `http://host:port` 条目转换为 `tcpTargets`，把其他 `conifg` 条目转换为 `httpRules`；端口解析后保存为 number。`sysconfig.ini` 按行移除注释和空白，重复键保留最后一项，键统一为大写。

- [ ] **步骤 4：增加导入导出往返测试和最小实现**

```ts
test("export and re-import preserves normalized config", async () => {
  const original = await importLegacyConfig("test/fixtures/legacy");
  const exported = exportInternalJson(original);
  const restored = parseInternalJson(exported);
  assert.deepEqual(restored.httpRules, original.httpRules);
  assert.equal(restored.accounts.ptjy.password, original.accounts.ptjy.password);
});
```

`config-store.ts` 实现 `ConfigStore.load()`、`save(config)`、`importLegacy(directory)`、`exportInternalJson(config)` 和 `exportLegacy(config, directory)`；保存路径由构造函数传入，写文件采用临时文件后 rename，避免中断造成半个 JSON。

- [ ] **步骤 5：运行配置测试确认通过**

运行：`npx tsx --test test/core/config/*.test.ts`

预期：全部 PASS，并验证错误 JSON、缺失文件、非法端口会返回包含文件名和字段名的错误。

- [ ] **步骤 6：提交配置模块**

```bash
git add src/core/config test/fixtures/legacy test/core/config
git commit -m "feat: import and store forwarding configuration"
```

## 任务 3：实现路由匹配、变量替换和敏感日志过滤

**文件：**
- 创建：`src/core/routing/rule-matcher.ts`、`src/core/runtime/redact.ts`
- 测试：`test/core/routing/rule-matcher.test.ts`

- [ ] **步骤 1：编写规则匹配失败测试**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { matchRule, substituteVariables } from "../../../src/core/routing/rule-matcher";

test("chooses the longest enabled path match", () => {
  const rule = matchRule("/reqxml?Action=100", [
    { id: "short", name: "all", match: "/", target: "http://127.0.0.1:80", enabled: true },
    { id: "long", name: "xml", match: "/reqxml", target: "tcp://127.0.0.1:7778", enabled: true },
  ]);
  assert.equal(rule?.id, "long");
});

test("replaces local variables without changing unknown placeholders", () => {
  assert.equal(substituteVariables("/reqxml?Token=($TOKEN)&x=($UNKNOWN)", { TOKEN: "abc" }), "/reqxml?Token=abc&x=($UNKNOWN)");
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/routing/rule-matcher.test.ts`

预期：FAIL，报错 `Cannot find module '../../../src/core/routing/rule-matcher'`。

- [ ] **步骤 3：实现确定性匹配和替换**

`matchRule(url, rules)` 过滤 `enabled === true`，按 `match.length` 降序和 `id` 升序选择首个 `url.includes(match)` 的规则；`parseTarget(target)` 只接受 `http:`、`https:`、`tcp:`，端口缺失时使用协议默认端口。`substituteVariables` 只替换 `($KEY)`、`%28$KEY%29` 和 `%28%24KEY%29`，键比较不区分大小写。

- [ ] **步骤 4：实现脱敏并补充边界测试**

`redactObject(value)` 深度复制对象，将键名匹配 `password|token|mobile|account|secret|authorization` 的字符串替换为 `***`；`redactQuery(url)` 只保留查询参数名并遮蔽上述参数值。测试禁用规则、默认端口、非法协议、重复匹配和 URL 编码占位符。

- [ ] **步骤 5：运行测试并提交**

运行：`npx tsx --test test/core/routing/rule-matcher.test.ts`

预期：全部 PASS。

```bash
git add src/core/routing src/core/runtime/redact.ts test/core/routing
git commit -m "feat: add forwarding rule matching and redaction"
```

## 任务 4：实现 TZT 编解码适配和 TCP 长连接桥

**文件：**
- 创建：`src/core/tcp/tzt-codec.ts`、`src/core/tcp/tcp-bridge.ts`
- 创建：`assets/tzt.bytecode`、`assets/tzt.bytecode-16.13.0` 或构建时复制规则
- 测试：`test/core/tcp/tzt-codec.test.ts`、`test/core/tcp/tcp-bridge.test.ts`

- [ ] **步骤 1：迁移参考工程协议回归测试**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTztCodec } from "../../../src/core/tcp/tzt-codec";

test("codec keeps legacy RC4 and JSON frame bytes", () => {
  const codec = createTztCodec();
  assert.equal(codec.rc4(Buffer.from("Plaintext"), "file").toString("hex"), "7ad9f940a0c3d07a8f");
  const frame = codec.encode({ Action: "100", foo: "bar" }, 12);
  assert.equal(frame.toString("hex"), "b707250000006400000000020000003132009617e8f7adba12dc8067265b85505ab73a8b8040e9ccde05f0");
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/tcp/tzt-codec.test.ts`

预期：FAIL，报错 `Cannot find module '../../../src/core/tcp/tzt-codec'`。

- [ ] **步骤 3：实现运行时适配器**

`createTztCodec()` 优先加载随应用打包的兼容实现；兼容实现内部保留参考工程 `RC4`、`jsonltzt`、`tztljson` 和按 `host:port` 保存拆包余量的逻辑。启动时必须执行固定字节回归测试；Electron V8 拒绝旧 cached bytecode 时抛出包含“TZT codec runtime incompatible”和解决路径的错误，不允许静默返回错误数据。打包配置把协议资产放入 `resources/protocol`，不得把用户配置打入安装包。

- [ ] **步骤 4：编写 TCP 桥失败测试**

```ts
test("bridge correlates split responses and reuses one target connection", async () => {
  const fake = await createFakeTztServer();
  const bridge = new TcpBridgePool({ connectTimeoutMs: 200, requestTimeoutMs: 500 });
  const first = bridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "100" });
  const second = bridge.request({ host: "127.0.0.1", port: fake.port }, { Action: "101" });
  assert.deepEqual(await first, { Action: "100", ERRORNO: "0" });
  assert.deepEqual(await second, { Action: "101", ERRORNO: "0" });
  assert.equal(fake.connectionCount, 1);
  await bridge.close();
  await fake.close();
});
```

- [ ] **步骤 5：运行测试确认失败并实现 TCP 桥**

运行：`npx tsx --test test/core/tcp/tcp-bridge.test.ts`

预期：FAIL，随后实现 `TcpBridgePool.request(target, query)`、`close()`、按 `host:port` 复用 `net.Socket`、递增 `HandleSerialNo`、pending Map、拆包/粘包处理、单请求超时和断线时批量 reject。

- [ ] **步骤 6：验证 TCP 场景并提交**

运行：`npx tsx --test test/core/tcp/*.test.ts`

预期：全部 PASS，覆盖拼包、拆包、连接复用、连接失败、请求超时和 codec 不兼容。

```bash
git add src/core/tcp assets test/core/tcp
git commit -m "feat: add TZT TCP forwarding bridge"
```

## 任务 5：实现 HTTP/HTTPS 代理和特殊本地接口

**文件：**
- 创建：`src/core/http/http-proxy.ts`
- 测试：`test/core/http/http-proxy.test.ts`

- [ ] **步骤 1：编写本地 HTTP 目标测试**

```ts
test("forwards GET and POST while preserving binary responses", async () => {
  const target = await createTargetServer();
  const proxy = new HttpProxy({
    bindHost: "127.0.0.1",
    port: 0,
    rules: [{ id: "api", name: "api", match: "/api", target: `http://127.0.0.1:${target.port}`, enabled: true }],
    localValues: { TOKEN: "fixture-token" },
    timeoutMs: 500,
  });
  const address = await proxy.start();
  const response = await fetch(`http://127.0.0.1:${address.port}/api?token=($TOKEN)`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  await proxy.stop();
  await target.close();
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/http/http-proxy.test.ts`

预期：FAIL，报错 `Cannot find module '../../../src/core/http/http-proxy'`。

- [ ] **步骤 3：实现 HTTP 服务和转发请求**

`HttpProxy.start()` 使用 `http.createServer`，监听传入的 bindHost/port；每个请求先路由特殊接口，再用 `matchRule` 选规则。请求体读取上限为 16 MiB，超过上限返回 413；请求方法、headers 和 body 传给 `http.request`/`https.request`，目标失败返回 502，超时返回 504。目标 HTTPS 使用 `rejectUnauthorized: false` 仅用于兼容参考工程，并在设置页显示安全提示。

- [ ] **步骤 4：实现响应处理和特殊接口**

实现 `/reqlocal`、`/reqsavemap`、`/reqreadmap`、`/reqsavefile`、`/reqreadfile`、`/login`、`/reqxml`：前五类由内存/配置 store 处理，`/login` 转成配置中的 login rule，`/reqxml` 调用 `TcpBridgePool.request`。响应解压只支持 `gzip` 和 `deflate`，移除旧 `content-encoding`/`content-length` 后返回；`application/octet-stream`、图片和未知二进制绝不 JSON.parse。

- [ ] **步骤 5：补充失败、gzip、二进制和 `/reqxml` 测试**

运行：`npx tsx --test test/core/http/http-proxy.test.ts`

预期：全部 PASS，明确验证 413、502、504、gzip JSON、二进制 bytes、变量替换、特殊接口和 TCP 错误映射。

- [ ] **步骤 6：提交 HTTP 模块**

```bash
git add src/core/http test/core/http
git commit -m "feat: add HTTP and HTTPS forwarding server"
```

## 任务 6：实现本地缓存和 `.d` 资源处理

**文件：**
- 创建：`src/core/cache/file-cache.ts`
- 测试：`test/core/cache/file-cache.test.ts`

- [ ] **步骤 1：编写路径安全和缓存行为测试**

```ts
test("rejects traversal and serves a cached file without downloading", async () => {
  const cache = new FileCache({ rootDir: await mkdtemp(join(tmpdir(), "forwarder-cache-")) });
  await assert.rejects(() => cache.resolve("../secret.js"), /outside cache root/);
  await cache.write("app.js", Buffer.from("cached"));
  const result = await cache.getOrDownload("app.js", async () => { throw new Error("download must not run"); });
  assert.equal(result.source, "cache");
  assert.equal(result.data.toString(), "cached");
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/cache/file-cache.test.ts`

预期：FAIL，报错 `Cannot find module '../../../src/core/cache/file-cache'`。

- [ ] **步骤 3：实现安全路径和下载写入**

`FileCache.resolve(relativePath)` 使用 `path.resolve(rootDir, relativePath)` 并验证结果以 `rootDir + path.sep` 开头；`getOrDownload` 按规范化路径加锁，避免相同资源并发下载两次；下载失败不留下临时文件。远程下载目标只允许配置的 host/port 和 `/download` 前缀。

- [ ] **步骤 4：实现 `.d` 解密、gzip 和损坏文件处理**

对 `.d` 文件取掉最后四个字符得到原始后缀；脚本类资源使用 `codec.rc4(data.subarray(0, -4), "file")`，`TZT.js` 再执行 `zlib.gunzip`；解密或解压失败时删除损坏缓存并返回明确错误。测试 RC4 固定向量、gzip 内容、图片二进制和损坏数据。

- [ ] **步骤 5：运行测试并提交**

运行：`npx tsx --test test/core/cache/file-cache.test.ts`

预期：全部 PASS。

```bash
git add src/core/cache test/core/cache
git commit -m "feat: add safe resource cache and d-file decoding"
```

## 任务 7：实现服务编排、状态和 IPC

**文件：**
- 创建：`src/core/runtime/forwarding-service.ts`
- 修改：`electron/main.ts`、`electron/preload.ts`、`src/shared/contracts.ts`
- 测试：`test/core/runtime/forwarding-service.test.ts`、`test/electron/ipc-contract.test.ts`

- [ ] **步骤 1：编写生命周期失败测试**

```ts
test("service stops all listeners after a start failure", async () => {
  const service = new ForwardingService({ config: createDefaultConfig({ port: 1 }) });
  await assert.rejects(() => service.start(), /port|permission/i);
  assert.equal(service.status().state, "error");
  await service.stop();
  assert.equal(service.status().state, "stopped");
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`npx tsx --test test/core/runtime/forwarding-service.test.ts`

预期：FAIL，报错 `Cannot find module '../../../src/core/runtime/forwarding-service'`。

- [ ] **步骤 3：实现 ForwardingService**

实现 `start()`、`stop()`、`status()`、`getConfig()`、`saveConfig()`、`getLogs()`。`start()` 先校验配置，再创建 cache、TCP pool、HTTP proxy；任一资源失败时按逆序关闭已经创建的资源并进入 `error`。`stop()` 幂等，先停止接收新请求，再关闭 HTTP server、TCP sockets 和 cache locks。日志通过回调写入环形缓冲区，最多保留 2,000 条。

- [ ] **步骤 4：注册 IPC 并测试白名单**

`main.ts` 将 `IPC_CHANNELS` 中的每个 channel 映射到一个 service 方法；`preload.ts` 不提供任意 `send/invoke`，只提供 `start`、`stop`、`status`、`getConfig`、`saveConfig`、`importLegacy`、`exportConfig`、`getLogs`。renderer 传入对象必须经过共享 schema 校验。

- [ ] **步骤 5：运行服务和 IPC 测试并提交**

运行：`npx tsx --test test/core/runtime/forwarding-service.test.ts test/electron/ipc-contract.test.ts`

预期：全部 PASS，包含端口占用、重复 start/stop、配置错误和 IPC 未知 channel 被拒绝。

```bash
git add src/core/runtime src/shared/contracts.ts electron test/core/runtime test/electron
git commit -m "feat: orchestrate forwarding service through IPC"
```

## 任务 8：实现规则优先控制台界面

**文件：**
- 创建：`src/renderer/App.tsx`、`src/renderer/components/RuleList.tsx`、`RuntimePanel.tsx`、`LogPanel.tsx`、`ConfigPages.tsx`、`styles.css`
- 修改：`src/renderer/main.tsx`、`src/shared/contracts.ts`

- [ ] **步骤 1：编写 renderer 交互验收清单**

在 `test/renderer/README.md` 写入可执行验收步骤：启动/停止按钮状态变化、规则开关调用 `saveConfig`、端口占用错误显示、日志过滤、变量掩码、导入旧配置和导出配置。每项注明输入、预期 UI 和 IPC 调用，不引入真实账号数据。

- [ ] **步骤 2：实现主布局**

`App.tsx` 使用 `useEffect` 初始读取 `getConfig/status/logs`，左侧 `RuleList` 渲染规则，右侧 `RuntimePanel` 渲染服务状态，底部 `LogPanel` 渲染日志；页面切换状态只允许 `runtime | rules | values | cache | logs | settings`。

- [ ] **步骤 3：实现规则和运行交互**

`RuleList` 支持按名称/路径搜索、启停、选择和新增/删除；`RuntimePanel` 显示 `127.0.0.1:83`、协议状态、请求量、成功率、延迟、TCP 连接数，并在 `error` 状态显示可复制错误详情。启动按钮在 `starting/running/stopping` 时禁用，防止重复调用。

- [ ] **步骤 4：实现变量、缓存、日志和设置页面**

变量页默认掩码敏感键；缓存页展示 rootDir、命中数、未命中数和清理按钮；日志页支持 level/rule 搜索并默认使用 `redactObject` 后的数据；设置页提供导入路径选择、导出路径选择、绑定地址、端口、超时和日志开关。

- [ ] **步骤 5：运行构建和手工验收**

运行：`npm run build`

预期：`dist/index.html` 与 `dist-electron/main.js` 生成；`npm run dev` 打开窗口，不能出现 renderer 的 Node 集成警告。

- [ ] **步骤 6：提交界面**

```bash
git add src/renderer src/shared/contracts.ts test/renderer
git commit -m "feat: add rule-first forwarding console"
```

## 任务 9：接入端到端测试和 Electron 生命周期冒烟

**文件：**
- 创建：`scripts/smoke-electron.mjs`
- 修改：`test/core/http/http-proxy.test.ts`、`test/core/tcp/tcp-bridge.test.ts`、`test/core/runtime/forwarding-service.test.ts`

- [ ] **步骤 1：补充端到端测试夹具**

使用 `node:http` 启动本地目标服务，使用 `node:net` 启动会返回固定 TZT 帧的 fake TCP 服务，所有端口使用 `0` 由系统分配；测试结束在 `finally` 中关闭所有 server 和 socket。

- [ ] **步骤 2：运行完整测试确认遗漏**

运行：`npm test`

预期：所有配置、路由、HTTP、TCP、缓存、运行时和 IPC 测试 PASS；任何真实网络目标都不得出现在测试输出中。

- [ ] **步骤 3：实现 Electron 冒烟脚本**

`smoke-electron.mjs` 启动 `electron . --no-sandbox`，等待 renderer 发出 `forwarder-ready`，调用一次 status IPC，验证主进程可以启动和关闭，然后发送 SIGTERM；超时 10 秒退出并返回非零状态。

- [ ] **步骤 4：运行冒烟并提交**

运行：`npm run build && npm run smoke`

预期：输出 `electron smoke: PASS`，进程退出码为 0。

```bash
git add scripts test
git commit -m "test: add forwarding integration and Electron smoke checks"
```

## 任务 10：配置 Intel x64 打包并进行发布前验证

**文件：**
- 创建：`electron-builder.yml`
- 修改：`package.json`、`.gitignore`

- [ ] **步骤 1：配置 Intel x64 `.dmg`**

`electron-builder.yml` 固定 `mac.target: dmg`、`mac.arch: x64`，将 `dist`、`dist-electron`、`assets/protocol` 纳入包内，将 `node_modules` 中运行时依赖保留，将测试夹具、真实配置和 `.superpowers` 排除。

- [ ] **步骤 2：写入打包校验命令**

```bash
npm run package:x64
file release/*.dmg
```

预期：生成一个 `.dmg`，`file` 输出为 macOS disk image；构建日志明确目标为 `x64`。

- [ ] **步骤 3：执行安装后检查**

在 Intel Mac 上安装应用，验证首次启动、导入脱敏旧配置、监听 `127.0.0.1:83`、HTTP 规则、TCP fake 目标、缓存目录和停止清理；验证退出应用后重新打开仍能读取应用数据目录配置。

- [ ] **步骤 4：执行最终验证并提交**

运行：`npm test && npm run build && npm run smoke && npm run package:x64`

预期：四个命令均返回 0，`release` 中存在 Intel x64 `.dmg`，Git 状态只包含预期源码和文档。

```bash
git add package.json electron-builder.yml .gitignore
git commit -m "build: package Intel macOS application"
```

## 计划自检

- 规格中的 HTTP/HTTPS、TCP `/reqxml`、旧配置、缓存、`.d`、规则优先 UI、IPC 隔离、敏感信息过滤、错误处理、Intel x64 打包和测试均有对应任务。
- 占位符扫描已通过，所有实现步骤都包含明确文件、命令、接口或验收输出。
- 跨任务接口名称保持一致：`AppConfig`、`ForwardingService.start/stop/status`、`TcpBridgePool.request/close`、`HttpProxy.start/stop`、`IPC_CHANNELS`。
- 真实参考配置只作为导入输入，不进入仓库；协议资产单独测试并在打包阶段验证 Electron V8 兼容性。
