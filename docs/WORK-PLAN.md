# Intel Mac 本地转发工具：工作计划与进度

更新时间：2026-08-18

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

### 任务 4 当前状态

已提交基础实现：

- `src/core/tcp/tzt-codec.ts`
- `src/core/tcp/tcp-bridge.ts`
- `test/core/tcp/tzt-codec.test.ts`
- `test/core/tcp/tcp-bridge.test.ts`
- 提交：`863c2738c6601758f81924c054ff09ff6bed332d`

基础定向测试为 6/6，通过 Node/renderer TypeScript 检查和 diff 检查。

但任务 4 尚未完成质量放行，审查发现：

- 当前 codec 仍不是完整 legacy RC4/编解码兼容实现，长数据和完整 GBK 字符集覆盖不足。
- 尚未按计划接入可打包的协议 runtime/资产及 `resources/protocol` 规则。
- TCP 单请求超时、连接建立期间超时、迟到响应的隔离语义需要修复。
- 需要补充 pending 状态 `close()`、确定性粘包、非法帧和自检失败等测试。

全量 `npm test` 今日未能可靠完成：当前沙盒在 TCP/tsx IPC 场景报告 `EPERM`。该结果记录为环境阻塞，不视为测试通过。

## 明日优先事项

1. 修复并完成任务 4：先补失败测试，再完善 TZT legacy 兼容实现和 TCP 超时隔离。
2. 对任务 4 重新进行规格审查和代码质量审查；审查通过后再进入任务 5。
3. 实现 HTTP/HTTPS 代理及 `/reqlocal`、`/reqsavemap`、`/reqreadmap`、`/reqsavefile`、`/reqreadfile`、`/login`、`/reqxml`。
4. 继续实现缓存、服务编排、界面、端到端测试和 Intel x64 打包。

## 验证纪律

- 新功能先写失败测试，再实现最小代码。
- 每个任务完成后依次进行规格审查和代码质量审查。
- 不能把参考目录中的真实账号、手机号、Token 或完整用户配置复制进仓库。
- 只有在本轮实际运行并确认命令结果后，才能声明测试或构建通过。

## 当前工作区

- 分支：`local-forwarder`
- 今日停止时 HEAD：`863c2738c6601758f81924c054ff09ff6bed332d`
- 参考目录未修改。
- 明日从任务 4 的审查反馈继续，不需要重做任务 1～3。
