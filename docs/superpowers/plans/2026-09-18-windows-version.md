# Windows x64 版本实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans（当前会话执行）逐任务实现此计划。步骤使用复选框语法来跟踪进度。

**目标：** 为 Local Forwarder 交付 Windows 10/11 x64 NSIS 安装包，随包提供 Windows H5 编码器和 Node 16.13.0 TZT 运行时，并保持现有网络转发与资源处理功能。

**架构：** 在 Electron 主进程边界内增加平台资源解析；Windows 选择 h5encode-win-x86.exe 和随包 Node 16.13.0，macOS 继续选择现有 Mach-O 编码器。端口恢复使用 macOS/Windows 两套命令适配器，打包、校验和测试入口全部跨平台。

**技术栈：** Electron、electron-builder、TypeScript、Node.js node:test、React/Vite、Windows NSIS、netstat/taskkill。

---

## 文件清单

### 新建

- \`resources/protocol/encode/h5encode-win-x86.exe\`：从 \`/Users/hdw/Desktop/proxy/encode/h5encode.exe\` 复制。
- \`resources/protocol/node/win-x64/node.exe\`：官方 Node.js 16.13.0 Windows x64 运行时。
- \`resources/protocol/node/win-x64/LICENSE.txt\`：Node 运行时许可证。
- \`resources/icon.ico\`：Windows 安装包图标。
- \`scripts/run-tests.mjs\`：跨平台测试入口。
- \`scripts/verify-win.mjs\`：Windows 包内容和 PE 头校验。
- \`scripts/smoke-packaged.mjs\`：启动 packaged Windows 应用的 smoke。
- \`.github/workflows/windows.yml\`：Windows x64 构建工作流。

### 修改

- \`package.json\`、\`package-lock.json\`：跨平台名称和 Windows scripts。
- \`electron-builder.yml\`：跨平台 appId、NSIS、图标和资源。
- \`electron/paths.ts\`：平台/架构编码器路径。
- \`src/core/tcp/tzt-codec.ts\`：随包 Node 16 候选路径。
- \`src/core/encryption/encryptor.ts\`：跨平台测试编码器参数和身份哈希。
- \`src/core/runtime/port-recovery.ts\`：Windows netstat/taskkill 适配。
- 对应的 encryption、tzt、port-recovery、Electron contract 测试。
- \`docs/WORK-PLAN.md\`：Windows 支持、构建和验收记录。

## 任务 1：确认基线并准备原生资源

**文件：** 资源清单中的三个二进制/许可证文件。

- [ ] **步骤 1：运行基线**

运行：

~~~bash
npm test
npm run build
~~~

预期：记录当前工作树实际的测试和构建结果；已有失败不能归因于本次改动。

- [ ] **步骤 2：复制 Windows 编码器**

运行：

~~~bash
mkdir -p resources/protocol/encode
ditto /Users/hdw/Desktop/proxy/encode/h5encode.exe resources/protocol/encode/h5encode-win-x86.exe
file resources/protocol/encode/h5encode-win-x86.exe
~~~

预期：文件为 PE32/i386、大小非零；文件名明确反映它是 x86 子进程。

- [ ] **步骤 3：准备 Node 16.13.0 Windows x64 资源**

从官方 Node.js v16.13.0 Windows x64 压缩包复制 node.exe 和许可证到计划路径，运行：

~~~bash
file resources/protocol/node/win-x64/node.exe
wc -c resources/protocol/node/win-x64/node.exe
~~~

预期：node.exe 为非空 PE32+ x86-64 文件。不能用当前 macOS Node 替代；若当前环境无法获取 Windows 文件，在 Windows runner 中用相同官方版本补齐。

- [ ] **步骤 4：提交资源**

~~~bash
git add resources/protocol/encode/h5encode-win-x86.exe resources/protocol/node/win-x64/node.exe resources/protocol/node/win-x64/LICENSE.txt
git commit -m "build: add Windows protocol runtimes"
~~~

## 任务 2：平台编码器路径解析

**文件：** \`electron/paths.ts\`、\`test/electron/encryption-contract.test.ts\`。

- [ ] **步骤 1：写失败测试**

让路径函数接受可选的 platform/arch 参数，并加入：

~~~ts
assert.equal(
  getEncryptionEncoderPath("/project/dist-electron", false, "/ignored", "win32", "x64"),
  path.join("/project/resources", "protocol", "encode", "h5encode-win-x86.exe"),
);
assert.equal(
  getEncryptionEncoderPath("/project/dist-electron", true, "/packed/resources", "darwin", "x64"),
  path.join("/packed/resources", "protocol", "encode", "h5encode-mac-amd64"),
);
assert.throws(
  () => getEncryptionEncoderPath("/project/dist-electron", false, "/ignored", "win32", "arm64"),
  /unsupported.*win32.*arm64/i,
);
~~~

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/electron/encryption-contract.test.ts
~~~

预期：Windows 路径测试因现有函数始终返回 macOS 文件而失败。

- [ ] **步骤 3：实现最小解析**

签名改为：

~~~ts
getEncryptionEncoderPath(compiledMainDir, isPackaged, resourcesPath, platform = process.platform, arch = process.arch)
~~~

只允许 darwin/x64 和 win32/x64，其他组合抛出包含平台/架构的错误。

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/electron/encryption-contract.test.ts
git add electron/paths.ts test/electron/encryption-contract.test.ts
git commit -m "feat: resolve Windows encoder resource"
~~~

## 任务 3：随包 Node 16 TZT 运行时

**文件：** \`src/core/tcp/tzt-codec.ts\`、\`test/core/tcp/tzt-codec.test.ts\`。

- [ ] **步骤 1：写失败测试**

增加纯函数：

~~~ts
getNode16BinaryCandidates(protocolDir, platform, arch, env): string[]
~~~

测试 win32/x64 的第一资源候选为 protocol/node/win-x64/node.exe，环境变量 TZT_NODE16_BIN 优先，win32/arm64 不使用 x64 资源。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/core/tcp/tzt-codec.test.ts
~~~

预期：新候选接口或 Windows 资源断言失败。

- [ ] **步骤 3：实现候选和错误处理**

候选顺序固定为环境变量、Windows 随包资源、开发资源、现有外部 Node 16 路径。每个候选用 accessSync(X_OK) 验证。全部失败时错误必须包含 Node.js 16.13.0、TZT_NODE16_BIN 和候选路径；不能使用 Electron 自带 Node 加载旧 bytecode。

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/core/tcp/tzt-codec.test.ts
git add src/core/tcp/tzt-codec.ts test/core/tcp/tzt-codec.test.ts
git commit -m "feat: bundle Windows Node 16 TZT runtime"
~~~

## 任务 4：跨平台加密测试夹具

**文件：** \`src/core/encryption/encryptor.ts\`、\`test/core/encryption/encryptor.test.ts\`。

- [ ] **步骤 1：写失败测试**

测试夹具使用 process.execPath 作为编码器、临时 .mjs 作为额外参数；脚本读取最后一个输入路径并写入输入路径加 .d。保留完整、增量、删除输出、失败输出和临时目录清理断言。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/core/encryption/encryptor.test.ts
~~~

预期：现有 runEncoder 不支持 Node 夹具参数而失败。

- [ ] **步骤 3：实现最小变更**

给 EncryptDirectoryOptions 和 runEncoder 增加 encoderArgs?: string[]，执行：

~~~ts
execFileAsync(encoderPath, [...(encoderArgs ?? []), tempInputPath], { windowsHide: true })
~~~

编码器身份哈希同时包含编码器文件和参数 JSON；主进程使用真实 .exe 时参数为空。

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/core/encryption/encryptor.test.ts
git add src/core/encryption/encryptor.ts test/core/encryption/encryptor.test.ts
git commit -m "test: make encryption fixtures cross-platform"
~~~

## 任务 5：跨平台测试入口

**文件：** \`scripts/run-tests.mjs\`、\`package.json\`、测试入口 contract。

- [ ] **步骤 1：写失败 contract 测试**

断言 package.json 的 test script 调用 scripts/run-tests.mjs，且不包含 $()、rg --files 或 POSIX 管道拼接。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/electron/package-script-contract.test.ts
~~~

预期：当前 package script 仍使用 POSIX 命令替换而失败。

- [ ] **步骤 3：实现 Node 入口**

run-tests.mjs 递归读取 test 目录，筛选 .test.ts 并排序，再用：

~~~ts
spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" })
~~~

子进程非零时以相同状态退出；package.json 改为：

~~~json
"test": "npm run build && node scripts/run-tests.mjs"
~~~

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/electron/package-script-contract.test.ts
npm test
git add scripts/run-tests.mjs package.json test/electron/package-script-contract.test.ts
git commit -m "build: make test runner cross-platform"
~~~

## 任务 6：Windows 端口恢复

**文件：** \`src/core/runtime/port-recovery.ts\`、\`test/core/runtime/port-recovery.test.ts\`。

- [ ] **步骤 1：写失败测试**

增加 parseWindowsListeningProcessIds(output, port)，覆盖 IPv4、IPv6、重复 PID、其他端口和非 LISTENING 行；增加 terminateProcess(pid, force) 依赖，覆盖普通终止后强制终止和当前 PID 跳过。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/core/runtime/port-recovery.test.ts
~~~

预期：Windows 解析函数和新依赖不存在而失败。

- [ ] **步骤 3：实现平台命令**

macOS 保留 lsof 和 SIGTERM/SIGKILL；Windows 使用 netstat -ano -p tcp 及 taskkill /PID <pid> /T，第二阶段追加 /F。进程不存在视为已清理，其他命令错误向上抛出；8080–8089 范围和当前 PID 跳过逻辑不变。

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/core/runtime/port-recovery.test.ts test/core/runtime/forwarding-service.test.ts
git add src/core/runtime/port-recovery.ts test/core/runtime/port-recovery.test.ts test/core/runtime/forwarding-service.test.ts
git commit -m "feat: support Windows port recovery"
~~~

## 任务 7：Windows NSIS 配置和资源

**文件：** \`electron-builder.yml\`、\`package.json\`、\`package-lock.json\`、\`resources/icon.ico\`、配置 contract 测试。

- [ ] **步骤 1：写失败测试**

断言 builder 配置含 appId com.localforwarder.desktop、win target nsis 和 icon.ico；断言 package.json 含 package:win:x64 且调用 electron-builder --win nsis --x64。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/electron/package-config-contract.test.ts
~~~

预期：现有 Mac-only 配置失败。

- [ ] **步骤 3：实现配置**

package 名称/描述去掉 Mac 限定，appId 改为 com.localforwarder.desktop，builder 增加：

~~~yaml
win:
  target:
    - nsis
  icon: resources/icon.ico
~~~

增加：

~~~json
"package:win:x64": "npm run build && electron-builder --win nsis --x64 && npm run verify:win"
~~~

生成确定性的 ICO 图标，包含 256/128/64/32/16 像素层，并核验 ICO 头为 00 00 01 00；只更新 lockfile 根包名称，不升级无关依赖。

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/electron/package-config-contract.test.ts
git add electron-builder.yml package.json package-lock.json resources/icon.ico test/electron/package-config-contract.test.ts
git commit -m "build: add Windows NSIS packaging"
~~~

## 任务 8：Windows 包校验和 packaged smoke

**文件：** \`scripts/verify-win.mjs\`、\`scripts/smoke-packaged.mjs\`、\`package.json\`、包脚本 contract 测试。

- [ ] **步骤 1：写失败 contract 测试**

断言 verify:win 调用 verify-win.mjs，脚本检查 win-unpacked、Windows 编码器、Node 16、MZ/PE 头；断言 packaged smoke 默认定位 dist/win-unpacked/Local Forwarder.exe。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/electron/package-script-contract.test.ts
~~~

预期：脚本不存在而失败。

- [ ] **步骤 3：实现 PE 和包校验**

verify-win.mjs 用 fs 读取文件，检查非空、MZ、PE\\0\\0 和 machine 字段：编码器允许 0x014c，Node 运行时要求 0x8664；检查 app.asar、protocol、TZT bytecode、两个 Windows 资源和 NSIS 文件，任一缺失以非零退出。

- [ ] **步骤 4：实现 packaged smoke**

从 dist/win-unpacked/Local Forwarder.exe --smoke 启动，10 秒内要求 stdout 出现 forwarder-ready 且退出码为 0；超时时终止并输出 stderr；所有路径使用 path.join。

- [ ] **步骤 5：确认绿灯并提交**

~~~bash
npx tsx --test test/electron/package-script-contract.test.ts
git add scripts/verify-win.mjs scripts/smoke-packaged.mjs package.json test/electron/package-script-contract.test.ts
git commit -m "test: verify Windows package contents"
~~~

## 任务 9：Windows CI 和文档

**文件：** \`.github/workflows/windows.yml\`、\`docs/WORK-PLAN.md\`、workflow contract 测试。

- [ ] **步骤 1：写失败测试**

断言 workflow 使用 windows-latest、npm ci、npm test、npm run build、npm run package:win:x64，并上传 dist/*.exe 和 dist/win-unpacked。

- [ ] **步骤 2：确认红灯**

运行：

~~~bash
npx tsx --test test/electron/windows-workflow-contract.test.ts
~~~

预期：workflow 不存在而失败。

- [ ] **步骤 3：实现 workflow 和文档**

workflow 在 windows-latest 执行 checkout、npm ci、全量测试、构建、Windows 打包和产物上传。文档记录 Windows 10/11 x64、x86 编码器子进程、随包 Node 16、NSIS 安装路径和验收命令。

- [ ] **步骤 4：确认绿灯并提交**

~~~bash
npx tsx --test test/electron/windows-workflow-contract.test.ts
git add .github/workflows/windows.yml docs/WORK-PLAN.md test/electron/windows-workflow-contract.test.ts
git commit -m "ci: add Windows packaging workflow"
~~~

## 任务 10：完整验证和真实 Windows 验收

- [ ] **步骤 1：在当前 macOS 工作树验证**

运行：

~~~bash
npm test
npm run build
git diff --check HEAD~1
~~~

预期：全量测试和构建退出码为 0；空白检查无错误。当前 Electron GUI 若仍受 SIGABRT 阻塞，记录实际结果，不伪报 smoke 通过。

- [ ] **步骤 2：在 Windows x64 runner 验证**

运行：

~~~powershell
npm ci
npm test
npm run build
npm run package:win:x64
npm run verify:win
node scripts/smoke-packaged.mjs
~~~

预期：生成 NSIS 包；包内包含 PE32 编码器、PE32+ Node 16.13.0、TZT bytecode 和 renderer 资源；校验和 packaged smoke 退出码为 0。

- [ ] **步骤 3：安装后验收**

验证首次启动、配置重启恢复、多代理实例、HTTP/HTTPS、TCP /reqxml、H5 加密、.d 解密、8080–8089 端口恢复和卸载后的用户数据保留。

- [ ] **步骤 4：检查变更边界**

运行：

~~~bash
git status --short
git diff main...HEAD --stat
~~~

预期：变更只包含 Windows 实现、测试、资源、CI、文档和计划提交；不覆盖用户原有未提交改动。
