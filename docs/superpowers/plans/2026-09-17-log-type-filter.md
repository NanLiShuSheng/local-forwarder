# 日志类型筛选实现计划

> 面向 AI 代理的工作者：必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用 - [ ] 语法来跟踪进度。

**目标：** 为日志页面增加按请求 pathname 筛选的类型下拉框，默认显示 /reqxml，并支持项目特殊接口和普通转发路径。

**架构：** HttpProxy 在现有日志条目中写入入站 requestPath，共享辅助模块负责从新旧日志提取类型、生成固定加动态选项和执行匹配；LogPanel 仅组合类型、级别和文本条件，不新增 IPC 或配置持久化。

**技术栈：** TypeScript、React、Node node:test、tsx、现有 Vite/Electron 构建链。

---

## 文件清单

- 创建：src/shared/log-types.ts — 固定日志类型、旧日志 pathname 兜底解析、选项生成和类型匹配。
- 创建：test/shared/log-types.test.ts — 共享日志类型辅助函数的单元测试。
- 修改：src/shared/contracts.ts — 为 LogEntry 增加可选的 requestPath。
- 修改：src/core/http/http-proxy.ts — 从入站 URL 提取 pathname 并写入日志。
- 修改：test/core/http/http-proxy.test.ts — 验证普通路径和 /reqreadmap 路径的日志元数据，同时保留 fetch/xhr 断言。
- 修改：src/renderer/components/LogPanel.tsx — 增加默认 /reqxml 的类型下拉框并接入组合筛选。
- 修改：test/renderer/log-panel.test.ts — 验证类型控件、固定选项和动态普通路径选项。

当前 .worktrees/local-forwarder 已存在用户未提交改动，且部分改动与本计划文件重叠。实现时不得使用 git reset、git checkout -- 或覆盖式回退；每次编辑前保留现有行为，提交时只处理能够明确隔离的本任务内容，无法安全隔离时保持未提交并在交接中说明。

### 任务 0：确认已有工作树边界

**文件：** 无文件修改。

- [ ] 步骤 1：记录实现前状态

运行：

~~~bash
git status --short
git diff -- src/shared/contracts.ts src/core/http/http-proxy.ts src/renderer/components/LogPanel.tsx test/core/http/http-proxy.test.ts test/renderer/log-panel.test.ts
~~~

预期：确认上述文件已有的修改属于当前工作树，不回退、不覆盖；实现只在现有内容上追加 requestPath 和类型筛选行为。

- [ ] 步骤 2：确认规格文档存在且已提交

运行：

~~~bash
git log -1 --oneline -- docs/superpowers/specs/2026-09-17-log-type-filter-design.md
~~~

预期：显示 docs: define log type filter 提交，实施内容以该规格为准。

## 任务 1：实现共享日志类型辅助函数

**文件：**

- 创建：test/shared/log-types.test.ts
- 创建：src/shared/log-types.ts

- [ ] 步骤 1：先编写失败的测试

创建 test/shared/log-types.test.ts：

~~~ts
import assert from "node:assert/strict";
import test from "node:test";
import { ALL_LOG_TYPES, FIXED_LOG_TYPES, getLogType, getLogTypeOptions, matchesLogType, type LogTypeSource } from "../../src/shared/log-types";

function entry(values: Partial<LogTypeSource>): LogTypeSource {
  return { message: "GET /fallback", ...values };
}

test("prefers requestPath over request details", () => {
  assert.equal(getLogType(entry({ requestPath: "/reqxml", message: "GET /other" })), "/reqxml");
});

test("extracts a pathname from request details and strips its query string", () => {
  assert.equal(getLogType(entry({ requestParams: "GET /reqreadmap?key=value\n\nkey=value", message: "not a request" })), "/reqreadmap");
  assert.equal(getLogType(entry({ requestParams: "", message: "POST /reqlocal?token=TOKEN" })), "/reqlocal");
});

test("leaves a log without a parseable pathname untyped", () => {
  assert.equal(getLogType(entry({ requestParams: "not a request", message: "service started" })), undefined);
});

test("returns fixed types first and appends observed ordinary paths once", () => {
  const options = getLogTypeOptions([
    entry({ requestPath: "/api/data" }),
    entry({ requestPath: "/reqxml" }),
    entry({ requestPath: "/api/data" }),
    entry({ requestPath: "/api/other" }),
  ]);
  assert.deepEqual(options, [...FIXED_LOG_TYPES, "/api/data", "/api/other"]);
});

test("matches all logs for the all filter and only equal paths for a concrete filter", () => {
  const untyped = entry({ requestParams: "service started", message: "service started" });
  assert.equal(matchesLogType(untyped, ALL_LOG_TYPES), true);
  assert.equal(matchesLogType(entry({ requestPath: "/reqxml" }), "/reqxml"), true);
  assert.equal(matchesLogType(entry({ requestPath: "/reqxml" }), "/reqreadmap"), false);
  assert.equal(matchesLogType(untyped, "/reqxml"), false);
});
~~~

- [ ] 步骤 2：运行测试确认它因模块缺失而失败

运行：

~~~bash
npx tsx --test test/shared/log-types.test.ts
~~~

预期：FAIL，报告 src/shared/log-types 尚未找到；不得因为测试本身的断言或语法错误失败。

- [ ] 步骤 3：编写最少的共享实现

创建 src/shared/log-types.ts：

~~~ts
export const ALL_LOG_TYPES = "all" as const;
export const FIXED_LOG_TYPES = [
  "/reqxml",
  "/reqreadmap",
  "/reqlocal",
  "/reqsavemap",
  "/reqsavefile",
  "/reqreadfile",
  "/login",
] as const;

export interface LogTypeSource {
  requestPath?: string;
  requestParams?: string;
  message?: string;
}
const URL_BASE = "http://local-forwarder.invalid";

function pathnameFromRequestLine(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const target = raw.split(/\r?\n/, 1)[0]?.trim().split(/\s+/, 3)[1];
  if (target === undefined || target.length === 0) return undefined;
  try {
    return new URL(target, URL_BASE).pathname || "/";
  } catch {
    return undefined;
  }
}

export function getLogType(entry: LogTypeSource): string | undefined {
  if (entry.requestPath !== undefined && entry.requestPath.length > 0) return entry.requestPath;
  return pathnameFromRequestLine(entry.requestParams) ?? pathnameFromRequestLine(entry.message);
}

export function getLogTypeOptions(logs: readonly LogTypeSource[]): string[] {
  const options = new Set<string>(FIXED_LOG_TYPES);
  for (const entry of logs) {
    const type = getLogType(entry);
    if (type !== undefined) options.add(type);
  }
  return [...options];
}

export function matchesLogType(entry: LogTypeSource, selectedType: string): boolean {
  return selectedType === ALL_LOG_TYPES || getLogType(entry) === selectedType;
}
~~~

- [ ] 步骤 4：运行共享测试确认通过

运行：

~~~bash
npx tsx --test test/shared/log-types.test.ts
~~~

预期：5 个测试全部 PASS。

- [ ] 步骤 5：检查共享模块差异

运行：

~~~bash
git diff --check -- src/shared/log-types.ts test/shared/log-types.test.ts
~~~

预期：无空白错误；由于文件是新增文件，暂不将包含其他用户改动的文件加入暂存区。

## 任务 2：把入站 pathname 写入核心日志

**文件：**

- 修改：src/shared/contracts.ts
- 修改：src/core/http/http-proxy.ts
- 修改：test/core/http/http-proxy.test.ts

- [ ] 步骤 1：先扩展核心失败断言

在测试文件现有导入之后增加仅供红灯阶段使用的局部扩展类型：

~~~ts
type LoggedPath = LogEntry & { requestPath?: string };
~~~

在现有 logs only fetch or XHR requests and captures request and response details 测试中，在 requestType 断言附近加入：

~~~ts
assert.equal((logs[0] as LoggedPath | undefined)?.requestPath, "/api/data");
assert.equal((logs[1] as LoggedPath | undefined)?.requestPath, "/api/xhr");
~~~

在现有 handles local values, maps, files, and TCP reqxml without leaving data in the renderer 测试中增加日志捕获，并让 readMap 带有 sec-fetch-dest: empty：

~~~ts
const logs: LogEntry[] = [];
// HttpProxy options 中增加：
onLog: (entry) => logs.push(entry),
// readMap 请求增加：
const readMap = await fetch(
  "http://127.0.0.1:" + address.port + "/reqreadmap?key=x",
  { headers: { "sec-fetch-dest": "empty" } },
);
// 断言 readMap 响应后增加：
assert.equal((logs.at(-1) as LoggedPath | undefined)?.requestPath, "/reqreadmap");
~~~

确保 LoggedPath 只用于让红灯测试在共享契约尚未增加字段时保持可编译；LogEntry 仍从测试文件现有导入中复用，不重复引入类型。

- [ ] 步骤 2：运行核心测试确认失败

运行：

~~~bash
npx tsx --test test/core/http/http-proxy.test.ts
~~~

预期：与 requestPath 相关的断言 FAIL，现有 requestType、请求详情和响应详情断言仍通过；失败原因是核心日志尚未写入 pathname。

- [ ] 步骤 3：增加共享契约字段

在 src/shared/contracts.ts 的 LogEntry 中保留现有 requestType，紧接着增加：

~~~ts
  requestPath?: string;
~~~

不要修改 requestType?: "fetch" | "xhr" 的类型和含义。

- [ ] 步骤 4：在 HttpProxy 中提取并写入 pathname

在 src/core/http/http-proxy.ts 的请求类型辅助函数附近增加：

~~~ts
function requestPathFor(requestUrl: string | undefined): string | undefined {
  try {
    return new URL(requestUrl ?? "/", "http://local-forwarder.invalid").pathname || "/";
  } catch {
    return undefined;
  }
}
~~~

在 handle 开头保留现有 requestType，并增加：

~~~ts
const requestPath = requestPathFor(request.url);
~~~

在 finally 的 onLog 对象中保留所有已有字段，并增加 requestPath：

~~~ts
requestPath,
~~~

如果当前 TypeScript 配置或 lint 对可选字段显式 undefined 有约束，则只在 requestPath !== undefined 时展开该字段；正常请求必须得到 / 或实际 pathname，异常 URL 不得阻止原日志写入。

- [ ] 步骤 5：运行核心测试确认通过

运行：

~~~bash
npx tsx --test test/core/http/http-proxy.test.ts
~~~

预期：该文件中的全部测试 PASS；/api/data、/api/xhr 和 /reqreadmap 的 requestPath 正确，原有 fetch/xhr 断言仍通过。

- [ ] 步骤 6：检查核心差异边界

运行：

~~~bash
git diff --check -- src/shared/contracts.ts src/core/http/http-proxy.ts test/core/http/http-proxy.test.ts
git diff --stat -- src/shared/contracts.ts src/core/http/http-proxy.ts test/core/http/http-proxy.test.ts
~~~

预期：只看到本任务的 requestPath 契约、采集和测试追加，以及用户原有改动仍保留；不要执行会覆盖用户改动的回退操作。

## 任务 3：接入日志页面类型筛选

**文件：**

- 修改：src/renderer/components/LogPanel.tsx
- 修改：test/renderer/log-panel.test.ts

- [ ] 步骤 1：先写 renderer 失败测试

在 test/renderer/log-panel.test.ts 中将现有 logWithResponse 返回值补充为带类型的 /reqxml 日志，避免默认筛选把已有详情测试数据隐藏：

~~~ts
function logWithResponse(responseData: string): LogEntry & { requestPath: string } {
  return {
  timestamp: "2026-09-04T00:00:00.000Z",
  level: "info",
  message: "GET /health",
  requestPath: "/reqxml",
  responseData,
  };
}
~~~

新增一个 renderer 静态渲染测试：

~~~ts
test("log panel exposes a request path type filter with reqxml selected by default", async () => {
  const panelSource = await readFile("src/renderer/components/LogPanel.tsx", "utf8");
  const logs: Array<LogEntry & { requestPath: string }> = [
      { timestamp: "2026-09-17T00:00:00.000Z", level: "info", message: "GET /reqxml?Action=100", requestPath: "/reqxml" },
      { timestamp: "2026-09-17T00:00:01.000Z", level: "info", message: "GET /reqreadmap?key=x", requestPath: "/reqreadmap" },
      { timestamp: "2026-09-17T00:00:02.000Z", level: "info", message: "GET /api/data", requestPath: "/api/data" },
  ];
  const markup = renderToStaticMarkup(createElement(LogPanel, {
    logs,
    selected: undefined,
    onSelect: () => undefined,
    onClear: async () => true,
    onFillJson: () => undefined,
  }));
  assert.match(panelSource, /getLogTypeOptions/);
  assert.match(panelSource, /matchesLogType/);
  assert.match(panelSource, /useState\("\/reqxml"\)/);
  assert.match(markup, /aria-label="日志类型"/);
  assert.match(markup, /<option value="all">全部<\/option>/);
  assert.match(markup, /<option value="\/reqxml">\/reqxml<\/option>/);
  assert.match(markup, /<option value="\/reqreadmap">\/reqreadmap<\/option>/);
  assert.match(markup, /<option value="\/api\/data">\/api\/data<\/option>/);
});
~~~

- [ ] 步骤 2：运行 renderer 测试确认失败

运行：

~~~bash
npx tsx --test test/renderer/log-panel.test.ts
~~~

预期：新增测试 FAIL，当前面板没有“日志类型”控件、类型辅助函数调用和 /reqxml 默认状态；已有日志详情和清空行为测试不应因测试 fixture 补充 requestPath 而失败。

- [ ] 步骤 3：接入类型状态和选项

在 LogPanel.tsx 的 import 中增加：

~~~ts
import { ALL_LOG_TYPES, getLogTypeOptions, matchesLogType } from "../../shared/log-types";
~~~

在现有 query、level 状态附近增加：

~~~ts
const [logType, setLogType] = useState("/reqxml");
const logTypeOptions = useMemo(() => getLogTypeOptions(logs), [logs]);
~~~

在 visible 的现有筛选条件中加入 matchesLogType(entry, logType)，并把 logType 加入依赖数组：

~~~ts
return matchesLogType(entry, logType)
  && (level === "all" || entry.level === level)
  && searchable.includes(query.toLowerCase());
~~~

- [ ] 步骤 4：在现有工具栏中增加类型下拉框

保留现有级别下拉框、文本输入框和清空按钮，在 .filters 内将以下控件放在级别下拉框之前：

~~~tsx
<select aria-label="日志类型" value={logType} onChange={(event) => setLogType(event.target.value)}>
  <option value={ALL_LOG_TYPES}>全部</option>
  {logTypeOptions.map((option) => <option value={option} key={option}>{option}</option>)}
</select>
~~~

不新增 CSS：现有 .filters select 和 .filters 换行规则已经覆盖下拉框布局。保留日志详情、清空按钮和其他用户已有的 LogPanel 改动。

- [ ] 步骤 5：运行 renderer 测试确认通过

运行：

~~~bash
npx tsx --test test/renderer/log-panel.test.ts
~~~

预期：该文件全部测试 PASS；静态 HTML 包含“全部”、固定特殊类型和当前日志中的 /api/data，默认列表只按 /reqxml 类型匹配。

- [ ] 步骤 6：检查 renderer 差异边界

运行：

~~~bash
git diff --check -- src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
git diff --stat -- src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
~~~

预期：没有空白错误；现有日志详情、清空和 JSON 回填相关改动仍存在。

## 任务 4：构建、完整验证和交接

**文件：** 不新增文件；仅验证任务 1 至任务 3 的修改。

- [ ] 步骤 1：运行共享、核心和 renderer 定向测试

运行：

~~~bash
npx tsx --test test/shared/log-types.test.ts test/core/http/http-proxy.test.ts test/renderer/log-panel.test.ts
~~~

预期：全部测试 PASS，无 TypeScript 运行时错误。

- [ ] 步骤 2：运行 TypeScript/Vite 构建

运行：

~~~bash
npm run build
~~~

预期：Electron、renderer TypeScript 检查和 Vite 构建全部成功。

- [ ] 步骤 3：运行完整测试

运行：

~~~bash
npm test
~~~

预期：完整构建和所有项目测试 PASS；若失败，区分本任务回归与工作树已有改动导致的问题后再处理。

- [ ] 步骤 4：完成最终差异与状态检查

运行：

~~~bash
git diff --check
git status --short
git diff -- src/shared/log-types.ts test/shared/log-types.test.ts src/shared/contracts.ts src/core/http/http-proxy.ts test/core/http/http-proxy.test.ts src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
~~~

预期：类型筛选相关改动完整，未修改无关文件；现有未提交用户改动原样保留，并在最终交接中明确列出。
