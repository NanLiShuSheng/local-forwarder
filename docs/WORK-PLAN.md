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

## 明日优先事项

1. 实现 HTTP/HTTPS 代理及 `/reqlocal`、`/reqsavemap`、`/reqreadmap`、`/reqsavefile`、`/reqreadfile`、`/login`、`/reqxml`。
2. 继续实现缓存、服务编排、界面、端到端测试和 Intel x64 打包。

## 验证纪律

- 新功能先写失败测试，再实现最小代码。
- 每个任务完成后依次进行规格审查和代码质量审查。
- 不能把参考目录中的真实账号、手机号、Token 或完整用户配置复制进仓库。
- 只有在本轮实际运行并确认命令结果后，才能声明测试或构建通过。

## 当前工作区

- 分支：`local-forwarder`
- 当前 HEAD：任务 4 提交已落地。
- 参考目录未修改。
- 任务 5 可从 HTTP/HTTPS 代理和特殊本地接口继续。
