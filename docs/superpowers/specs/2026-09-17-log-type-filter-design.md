# 日志类型筛选设计

## 目标

优化日志页面的定位效率，增加按请求路径类型筛选日志的能力。类型默认选中 `/reqxml`，同时支持查看全部日志、项目已有的特殊接口类型以及普通转发请求实际使用的 pathname。

## 范围

本次只调整日志条目的路径元数据、日志页面筛选和相关测试，不改变以下既有行为：

- 仅记录带有 `fetch` 或 `XMLHttpRequest` 请求特征的日志；
- 日志敏感信息处理、请求/应答详情截断和最多保留 2000 条日志；
- 级别筛选、文本搜索、日志详情、日志清空和 JSON 回填；
- 日志不持久化，筛选条件不写入配置文件。

## 类型定义与数据流

现有 `LogEntry.requestType` 表示浏览器请求方式（`fetch` 或 `xhr`），继续保留其含义。新增可选字段 `requestPath` 表示代理收到的入站 URL pathname，避免将两种“类型”混用。

日志采集流程调整为：

```text
IncomingMessage.url
  -> HttpProxy 提取 pathname
  -> LogEntry.requestPath
  -> ForwardingService 内存日志缓冲区
  -> runtime:logs IPC
  -> LogPanel 类型筛选
```

`HttpProxy` 记录请求收到时的 pathname。例如，客户端访问 `/login` 时类型为 `/login`；即使内部转发到 `/reqxml`，也不改写日志类型。

类型提取和匹配放在无 UI 依赖的共享辅助模块中：

- 优先使用 `requestPath`；
- 兼容缺少该字段的旧日志，从 `requestParams` 请求行解析 pathname，再从 `message` 请求行解析；
- 无法解析 pathname 的条目不归入任何具体类型，但在「全部」中保留；
- pathname 保留实际大小写和查询参数之外的路径部分，不把 query string 当作类型。

## 类型选项

类型下拉框的固定选项按以下顺序提供：

1. 全部；
2. `/reqxml`；
3. `/reqreadmap`；
4. `/reqlocal`；
5. `/reqsavemap`；
6. `/reqsavefile`；
7. `/reqreadfile`；
8. `/login`。

然后将当前日志中实际出现、且不在固定列表中的 pathname 追加到选项末尾，例如 `/api/data`。所有选项去重。这样即使某个特殊接口尚未产生日志，用户仍能提前选择它；普通转发路径也能直接筛选。

## 页面交互

`LogPanel` 在现有级别下拉框旁增加“日志类型”下拉框：

- 初始筛选值为 `/reqxml`；
- “全部”显示所有日志，包括没有可解析 pathname 的日志；
- 选择具体类型时只显示 `requestPath`（或兼容解析结果）完全相等的日志；
- 类型、级别和文本搜索同时生效；
- 日志数量继续显示当前筛选结果数量；
- 筛选只影响列表，不清除当前详情选择，保持现有筛选行为一致；
- 页面重新挂载时恢复默认 `/reqxml`，不新增持久化状态。

## 兼容性与边界

- `requestPath` 设计为可选，确保已有手工构造的 `LogEntry` 和历史数据仍可被读取；
- 新采集的请求会始终写入 pathname。无法解析异常 URL 时不抛出新的日志采集异常；
- 特殊接口类型来自当前 `HttpProxy` 已处理的 `/reqxml`、`/reqlocal`、`/reqsavemap`、`/reqreadmap`、`/reqsavefile`、`/reqreadfile` 和 `/login`；
- legacy action URL、静态资源和普通规则转发不额外创建固定类型，按其实际 pathname 动态出现；
- “全部”仍受现有最近 200 条展示限制，类型筛选不会扩大日志缓冲区或查询上限。

## 实现单元

- `src/shared/contracts.ts`：为 `LogEntry` 增加 `requestPath` 字段。
- `src/shared/log-types.ts`：提供固定类型列表、pathname 提取、类型选项生成和匹配辅助函数。
- `src/core/http/http-proxy.ts`：从入站请求 URL 生成并写入 `requestPath`。
- `src/renderer/components/LogPanel.tsx`：增加类型状态、类型下拉框和类型筛选组合逻辑。
- `test/shared/log-types.test.ts`：覆盖字段优先级、旧日志兜底、query 去除、未知路径和选项去重。
- `test/core/http/http-proxy.test.ts`：验证采集日志保存入站 pathname，并保留现有 `fetch/xhr` 类型。
- `test/renderer/log-panel.test.ts`：验证默认 `/reqxml`、固定选项、动态 pathname 和筛选连接。

## 验证标准

- `/reqxml` 日志在默认页面中可见，`/reqreadmap`、`/reqlocal` 等类型在选择后只显示对应日志；
- “全部”能显示特殊接口、普通 pathname 和无法解析类型的日志；
- 级别与文本筛选继续和类型筛选同时生效；
- 新日志的 `requestPath` 与入站 URL pathname 一致，`requestType` 仍正确记录 `fetch/xhr`；
- 相关共享、核心和 renderer 测试通过，TypeScript 构建和完整测试通过。
