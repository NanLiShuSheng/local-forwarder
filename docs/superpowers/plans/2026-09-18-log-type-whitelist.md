# 日志类型筛选白名单实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将日志类型下拉框限制为 6 个固定请求类别，同时保留未知请求在「全部」中的可见性。

**架构：** 在共享日志类型模块中维护唯一的固定白名单。`getLogType()` 继续解析任意请求路径，`matchesLogType()` 继续让「全部」匹配所有日志；只有 `getLogTypeOptions()` 不再把观察到的普通路径追加为选项。现有 `LogPanel` 已通过该辅助函数渲染选项，因此不需要修改生产渲染组件。

**技术栈：** TypeScript、React、Node.js 内置 `node:test`、`tsx`、Vite。

---

## 文件清单

- 修改：`src/shared/log-types.ts`——移除 `/login` 固定项，让选项生成函数只返回固定白名单。
- 修改：`test/shared/log-types.test.ts`——覆盖白名单顺序、动态路径不入选项和未知路径仍可解析。
- 修改：`test/renderer/log-panel.test.ts`——更新现有日志面板回归测试，确认渲染层不展示 `/login` 和动态 pathname，同时「全部」仍保留未知请求。
- 不修改：`src/renderer/components/LogPanel.tsx`、`src/renderer/log-type-preference.ts`——当前实现已经调用共享选项函数并具备失效选择回退逻辑。

`src/renderer/components/LogPanel.tsx` 和 `test/renderer/log-panel.test.ts` 当前存在用户未提交改动。执行时只在现有日志类型测试附近追加或调整断言，不回退、覆盖或重排其他改动。

### 任务 1：先写固定白名单回归测试

**文件：**

- 修改：`test/shared/log-types.test.ts`
- 修改：`test/renderer/log-panel.test.ts`

- [ ] **步骤 1：修改共享层失败测试**

在 `test/shared/log-types.test.ts` 中，将现有的动态选项测试替换为以下完整测试，并在「normalizes requestPath values」测试中保留对 `/login` 的解析断言：

```ts
test("normalizes requestPath values and rejects the all sentinel", () => {
  assert.equal(getLogType(entry({ requestPath: "/api?a=1#fragment" })), "/api");
  assert.equal(getLogType(entry({ requestPath: "https://host.test/api?x=1" })), "/api");
  assert.equal(getLogType(entry({ requestPath: "api/path?x=1" })), "/api/path");
  assert.equal(getLogType(entry({ requestPath: "/login" })), "/login");
  assert.equal(getLogType(entry({ requestPath: ALL_LOG_TYPES })), undefined);
  assert.equal(getLogType(entry({ requestPath: "/all" })), "/all");

  assert.deepEqual(getLogTypeOptions([entry({ requestPath: ALL_LOG_TYPES })]), [...FIXED_LOG_TYPES]);
});

test("returns only fixed types regardless of observed request paths", () => {
  const options = getLogTypeOptions([
    entry({ requestPath: "/api/first" }),
    entry({ requestPath: "/reqxml" }),
    entry({ message: "GET /api/second?value=1 HTTP/1.1" }),
    entry({ requestParams: "GET /api/first?value=2 HTTP/1.1" }),
    entry({ requestPath: "/login" }),
    entry({ requestPath: "/newzt/components/StepBtns/StepBtns.html" }),
  ]);

  assert.deepEqual(options, [...FIXED_LOG_TYPES]);
  assert.equal(options.includes("/login"), false);
  assert.equal(options.includes("/api/first"), false);
  assert.equal(options.includes("/api/second"), false);
  assert.equal(options.includes("/newzt/components/StepBtns/StepBtns.html"), false);
});
```

保留现有的 `matchesLogType()` 测试，确保它继续断言 `ALL_LOG_TYPES` 匹配未知路径和无类型日志。

- [ ] **步骤 2：修改渲染层失败测试**

在 `test/renderer/log-panel.test.ts` 的「server-rendered log panel exposes log type filter options」测试中，将日志 fixture 扩展为包含 `/login` 和截图中的普通路径，并将动态选项断言改为固定白名单断言：

```ts
  const logs: LogEntry[] = [
    { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "reqxml", requestPath: "/reqxml" },
    { timestamp: "2026-09-04T00:00:01.000Z", level: "info", message: "reqreadmap", requestPath: "/reqreadmap" },
    { timestamp: "2026-09-04T00:00:02.000Z", level: "info", message: "login", requestPath: "/login" },
    { timestamp: "2026-09-04T00:00:03.000Z", level: "info", message: "newzt", requestPath: "/newzt/components/StepBtns/StepBtns.html" },
  ];
```

在现有断言末尾使用：

```ts
  assert.match(markup, /<option value="all">全部<\/option>/);
  for (const type of ["/reqxml", "/reqreadmap", "/reqlocal", "/reqsavemap", "/reqsavefile", "/reqreadfile"]) {
    assert.match(markup, new RegExp(`<option value="${type}">${type}<\\/option>`));
  }
  assert.doesNotMatch(markup, /<option value="\/login">\/login<\/option>/);
  assert.doesNotMatch(markup, /<option value="\/newzt\/components\/StepBtns\/StepBtns\.html">/);
```

将现有「filters log entries by type」测试替换为以下完整测试，以证明未知请求仍能在「全部」中显示：

```ts
test("filters log entries by type, level, and text while preserving recent reverse order", () => {
  const logs: LogEntry[] = [
    { timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "target match", requestPath: "/reqxml" },
    { timestamp: "2026-09-04T00:00:01.000Z", level: "error", message: "other", requestPath: "/reqreadmap" },
    { timestamp: "2026-09-04T00:00:02.000Z", level: "info", message: "legacy match" },
    { timestamp: "2026-09-04T00:00:03.000Z", level: "info", message: "unlisted match", requestPath: "/newzt/components/StepBtns/StepBtns.html" },
  ];

  assert.deepEqual(filterLogEntries(logs, "/reqxml", "all", ""), [logs[0]]);
  assert.deepEqual(filterLogEntries(logs, ALL_LOG_TYPES, "all", ""), [logs[3], logs[2], logs[1], logs[0]]);
  assert.deepEqual(filterLogEntries(logs, ALL_LOG_TYPES, "error", "other"), [logs[1]]);
});
```

不要修改该文件中与日志详情、清空、JSON 回填或布局相关的既有测试。

- [ ] **步骤 3：运行测试确认正确失败**

运行：

```bash
npx tsx --test test/shared/log-types.test.ts test/renderer/log-panel.test.ts
```

预期：测试失败且失败原因是当前实现仍返回 `/login` 和观察到的动态路径；不能因为语法错误、模块找不到或测试环境初始化失败而失败。若出现后者，先修正测试修改本身，再重新运行，不能修改生产代码来掩盖测试错误。

### 任务 2：实现最小共享层修复

**文件：**

- 修改：`src/shared/log-types.ts`

- [ ] **步骤 1：移除不应展示的固定类型**

将 `FIXED_LOG_TYPES` 改为以下内容，保持既定顺序：

```ts
export const FIXED_LOG_TYPES = [
  "/reqxml",
  "/reqreadmap",
  "/reqlocal",
  "/reqsavemap",
  "/reqsavefile",
  "/reqreadfile",
] as const;
```

- [ ] **步骤 2：让选项生成只返回白名单**

将 `getLogTypeOptions()` 的实现替换为：

```ts
export function getLogTypeOptions(_logs: readonly LogTypeSource[]): string[] {
  return [...FIXED_LOG_TYPES];
}
```

保留 `getLogType()`、`matchesLogType()` 及路径规范化逻辑不变。这样 `/login` 和 `/newzt/...` 仍可被解析，在「全部」中保留，但不会进入选项数组。

- [ ] **步骤 3：运行共享和渲染测试确认通过**

运行：

```bash
npx tsx --test test/shared/log-types.test.ts test/renderer/log-panel.test.ts
```

预期：该命令报告所有测试通过；固定选项测试不再出现 `/login` 或动态路径，渲染层「全部」测试仍能看到未知请求。

- [ ] **步骤 4：提交不与用户改动重叠的共享文件**

只暂存干净的共享实现和共享测试文件，不暂存包含既有用户改动的 `test/renderer/log-panel.test.ts`：

```bash
git add src/shared/log-types.ts test/shared/log-types.test.ts
git commit -m "fix(shared): restrict log type options"
```

提交后用 `git status --short` 确认原有未提交文件仍保持在工作区；不得使用 `git checkout`、`git reset` 或其他回退命令清理它们。

### 任务 3：完整验证与交接

**文件：** 无新增生产文件；检查任务 1、任务 2 的差异。

- [ ] **步骤 1：检查相关差异和空白**

运行：

```bash
git diff --check HEAD~1 HEAD -- src/shared/log-types.ts test/shared/log-types.test.ts
git diff --check -- test/renderer/log-panel.test.ts
git show --format= --stat HEAD
git diff -- test/renderer/log-panel.test.ts
```

预期：无空白错误；最新提交只包含固定白名单共享改动；渲染测试只在日志类型筛选断言和 fixture 附近包含本次改动，其他用户改动保持原样。

- [ ] **步骤 2：运行构建**

运行：

```bash
npm run build
```

预期：TypeScript 编译和 Vite 构建退出码为 0，无新增错误。

- [ ] **步骤 3：运行完整测试**

运行：

```bash
npm test
```

预期：脚本先完成构建，再报告全部测试通过，退出码为 0。

- [ ] **步骤 4：逐项核对需求**

检查以下结果：

```text
下拉框：全部、/reqxml、/reqreadmap、/reqlocal、/reqsavemap、/reqsavefile、/reqreadfile
下拉框：不包含 /login、/newzt/...、/api/... 等额外路径
全部：仍显示 /login、/newzt/... 和无法解析类型的日志
具体类型：仍只显示完全匹配的固定类别
```

最后报告实际修改文件、定向测试、构建和完整测试的命令结果，并明确列出 worktree 中原有的未提交改动未被触碰。
