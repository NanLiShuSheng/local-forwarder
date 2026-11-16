# 日志类型筛选白名单设计

## 目标

日志类型下拉框只展示产品规定的 6 个固定请求类别。未纳入类别的请求仍然保留在日志中，并可通过「全部」查看，但不再根据实际日志路径生成额外的筛选类型。

## 问题与根因

当前 `src/shared/log-types.ts` 存在两处导致额外类型出现的逻辑：

- `FIXED_LOG_TYPES` 包含不应展示的 `/login`；
- `getLogTypeOptions()` 会把当前日志中解析出的任意 pathname 追加到固定选项后面。

因此，截图中的 `/login`、`/newzt/...` 等请求路径会被渲染为下拉选项。

## 行为规格

日志类型下拉框的选项固定为以下顺序：

1. 「全部」；
2. `/reqxml`；
3. `/reqreadmap`；
4. `/reqlocal`；
5. `/reqsavemap`；
6. `/reqsavefile`；
7. `/reqreadfile`。

具体规则：

- `FIXED_LOG_TYPES` 移除 `/login`，只保留上述 6 个路径；
- `getLogTypeOptions()` 始终返回固定类型，不再追加当前日志中出现的普通 pathname；
- `getLogType()` 继续解析任意请求路径，供「全部」筛选和兼容旧日志使用；
- 选择「全部」时，所有日志都可见，包括 `/login`、`/newzt/...`、普通 API 路径和无法解析请求类型的日志；
- 选择具体固定类型时，只显示解析结果与该类型完全一致的日志；
- 已持久化但不再属于固定选项的旧类型，由现有 `resolveLogTypeSelection()` 逻辑回退到「全部」，不清除本地存储值；
- 日志级别筛选、文本筛选、详情展示、清空日志和日志持久化行为保持不变。

## 数据流与实现边界

```text
日志条目
  -> getLogType() 解析 requestPath / requestParams / message
  -> matchesLogType() 判断具体类型，或在「全部」中保留
  -> getLogTypeOptions() 提供固定白名单
  -> LogPanel 渲染下拉框
```

本次只修改共享日志类型辅助函数及其相关测试、渲染层类型选项测试。不会修改 HTTP 日志采集、`LogEntry` 字段、IPC、`localStorage` 读写模块或其他筛选条件。

## 测试与验收

共享层测试需要验证：

- 固定选项严格等于 6 个路径，顺序正确；
- 固定选项不包含 `/login`、`/api/data` 或其他动态路径；
- `getLogType()` 仍能解析 `/login` 和普通请求路径；
- `matchesLogType(entry, "all")` 仍匹配未知路径和无类型日志。

渲染层测试需要验证：

- 日志类型下拉框包含「全部」和 6 个固定选项；
- 下拉框不包含 `/login`、`/newzt/...` 或测试日志中的普通路径；
- 选择「全部」时普通请求仍能出现在日志列表中；
- 已失效的持久化类型会回退到「全部」。

验收命令：

```bash
npx tsx --test test/shared/log-types.test.ts test/renderer/log-panel.test.ts
npm run build
npm test
```

验收标准是定向测试、构建和完整测试均通过，且 `git diff --check` 无格式错误。
