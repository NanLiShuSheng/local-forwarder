# 日志功能优化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为日志页面增加当前代理实例日志清空、请求参数源码/浏览器式键值解析切换，以及应答数据回填到 JSON 可视化页面的能力。

**架构：** 新增无 UI 依赖的共享请求日志解析器；清空日志沿现有 `ForwardingServiceManager`、Electron IPC 和 preload 链路贯通当前选中实例。renderer 由 App 持有日志清空和一次性 JSON 回填状态，`LogPanel` 负责详情交互，`JsonPreviewPage` 负责接收文本并复用现有解析、树形和表格视图。

**技术栈：** React + TypeScript、Electron IPC、现有 CSS 变量主题、Node `node:test` + `tsx`。

---

## 文件清单与职责

**创建：**

- `src/shared/log-details.ts`：解析日志中的请求行、查询参数和表单请求体，输出浏览器式键值数据。
- `test/shared/log-details.test.ts`：覆盖日志请求解析器的正常和降级行为。
- `docs/superpowers/plans/2026-09-04-log-optimization.md`：记录本实现计划。

**修改：**

- `src/shared/contracts.ts`：增加 `ForwarderApi.clearLogs` 和 `runtime:logs:clear` IPC 通道。
- `src/core/runtime/forwarding-service.ts`：增加清空当前服务日志缓冲区的方法。
- `src/core/runtime/forwarding-service-manager.ts`：向当前代理实例转发清空请求。
- `electron/main.ts`、`electron/preload.ts`：注册并暴露清空日志 IPC。
- `src/renderer/components/LogPanel.tsx`：增加清空按钮、源码/解析结果 Tab、键值行和 JSON 回填按钮。
- `src/renderer/App.tsx`：提供清空日志回调和一次性 JSON 回填页面跳转。
- `src/renderer/components/JsonPreviewPage.tsx`：接收回填文本并重新解析。
- `src/renderer/styles.css`：补充日志详情 Tab、键值行和操作区样式，保持窄屏布局。

**测试：**

- `test/core/runtime/forwarding-service.test.ts`：验证服务缓冲区清空后可继续记录。
- `test/core/runtime/forwarding-service-manager.test.ts`：验证清空只作用于指定/当前实例，并同步更新 fake service 契约。
- `test/electron/ipc-contract.test.ts`、`test/electron/preload-contract.test.ts`：验证 IPC 常量和编译后的 preload 暴露清空 API。
- `test/renderer/log-panel.test.ts`：验证日志交互和展示契约。
- `test/renderer/navigation.test.ts`、`test/renderer/json-preview.test.ts`：验证日志到 JSON 页面的回填连接和页面接收回填文本。

### 任务 1：实现请求日志键值解析器

**文件：**

- 创建：`src/shared/log-details.ts`
- 测试：`test/shared/log-details.test.ts`

- [ ] **步骤 1：编写失败测试**

新增纯函数契约，要求导出以下类型和函数：

```ts
export interface LogKeyValue {
  key: string;
  value: string;
}

export interface ParsedLogRequest {
  method: string;
  path: string;
  query: LogKeyValue[];
  body: LogKeyValue[];
  rawBody?: string;
}

export function parseLogRequestParams(raw: string): ParsedLogRequest;
```

测试至少覆盖：

```ts
test("parses request line, query parameters, and form body", () => {
  const result = parseLogRequestParams("GET /reqxml?Action=100&Action=101\n\naccount=600554432&name=%E5%BC%A0%E4%B8%89");

  assert.deepEqual(result, {
    method: "GET",
    path: "/reqxml",
    query: [
      { key: "Action", value: "100" },
      { key: "Action", value: "101" },
    ],
    body: [
      { key: "account", value: "600554432" },
      { key: "name", value: "张三" },
    ],
  });
});

test("keeps an unparseable body as raw text", () => {
  const result = parseLogRequestParams("POST /api\n\n{\"code\":1}");

  assert.equal(result.method, "POST");
  assert.equal(result.path, "/api");
  assert.deepEqual(result.body, []);
  assert.equal(result.rawBody, "{\"code\":1}");
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
node --import tsx --test test/shared/log-details.test.ts
```

预期：FAIL，提示 `src/shared/log-details` 尚不存在。

- [ ] **步骤 3：实现最少解析逻辑**

实现顺序固定为：拆出第一行请求方法和目标、用 `new URL(target, "http://local-forwarder.invalid")` 解析路径与查询参数、使用 `URLSearchParams` 保留重复查询键，再对空行后的请求体做同样的表单解析。请求体不含可识别的 `=` 参数时，返回空 `body` 和完整 `rawBody`，不抛出异常。

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
node --import tsx --test test/shared/log-details.test.ts
```

预期：所有共享解析器测试 PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/shared/log-details.ts test/shared/log-details.test.ts
git commit -m "feat: parse request details for logs"
```

### 任务 2：贯通当前代理实例的日志清空 IPC

**文件：**

- 修改：`src/shared/contracts.ts`、`src/core/runtime/forwarding-service.ts`、`src/core/runtime/forwarding-service-manager.ts`
- 修改：`electron/main.ts`、`electron/preload.ts`
- 测试：`test/core/runtime/forwarding-service.test.ts`、`test/core/runtime/forwarding-service-manager.test.ts`、`test/electron/ipc-contract.test.ts`、`test/electron/preload-contract.test.ts`

- [ ] **步骤 1：先扩展失败测试和 fake service 契约**

在运行时测试中让 fake HTTP 工厂捕获 `onLog`，注入带 `requestType` 的日志后断言：

```ts
onLog?.({ timestamp: "2026-09-04T00:00:00.000Z", level: "info", message: "GET /api", requestType: "fetch" });
assert.equal(service.getLogs().length, 1);
service.clearLogs();
assert.deepEqual(service.getLogs(), []);
```

在 manager fake service 中增加 `clearLogs()`，并添加“切换到另一个实例后只清空当前实例”的断言。IPC 契约的完整对象增加 `clearLogs: "runtime:logs:clear"`，preload 编译契约增加 `clearLogs` 字符串断言。

- [ ] **步骤 2：运行相关测试验证失败**

运行：

```bash
node --import tsx --test test/core/runtime/forwarding-service.test.ts test/core/runtime/forwarding-service-manager.test.ts test/electron/ipc-contract.test.ts
```

预期：FAIL，提示 `clearLogs` 方法、API 类型或 IPC 常量尚不存在。

- [ ] **步骤 3：实现运行时和 IPC 链路**

按以下接口保持名称一致：

```ts
// ForwardingService
public clearLogs(): void {
  this.logBuffer.length = 0;
}

// ManagedForwardingService / ForwardingServiceManager
clearLogs(): void;
public clearLogs(id = this.workspace.selectedInstanceId): void {
  this.requireService(id).clearLogs();
}

// ForwarderApi
clearLogs(): Promise<OperationResult>;
```

在 `IPC_CHANNELS` 和 preload 中增加 `runtime:logs:clear`。主进程 handler 调用 `manager.clearLogs()`，成功返回 `{ ok: true }`，异常返回 `{ ok: false, error }`，与现有保存配置等操作保持一致。

- [ ] **步骤 4：运行测试验证通过**

运行：

```bash
node --import tsx --test test/core/runtime/forwarding-service.test.ts test/core/runtime/forwarding-service-manager.test.ts test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts
```

预期：运行时、manager、IPC 和 preload 测试全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/shared/contracts.ts src/core/runtime/forwarding-service.ts src/core/runtime/forwarding-service-manager.ts electron/main.ts electron/preload.ts test/core/runtime/forwarding-service.test.ts test/core/runtime/forwarding-service-manager.test.ts test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts
git commit -m "feat: add runtime log clearing"
```

### 任务 3：实现日志详情源码/解析结果和清空交互

**文件：**

- 修改：`src/renderer/components/LogPanel.tsx`、`src/renderer/styles.css`
- 测试：`test/renderer/log-panel.test.ts`

- [ ] **步骤 1：编写失败的 renderer 契约测试**

在现有日志面板测试中增加断言：组件导入 `parseLogRequestParams`，props 包含 `onClear` 和 `onFillJson`，页面包含「清空日志」「源码」「解析结果」「回填到 JSON 可视化」以及 `key: value` 展示类名；样式包含详情 Tab、键值行和窄屏换行规则。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
node --import tsx --test test/renderer/log-panel.test.ts
```

预期：FAIL，提示新增按钮、解析器引用或样式契约不存在。

- [ ] **步骤 3：实现日志面板交互**

将组件签名改为：

```ts
export function LogPanel({
  logs,
  onClear,
  onFillJson,
}: {
  logs: LogEntry[];
  onClear: () => Promise<boolean>;
  onFillJson: (text: string) => void;
})
```

增加 `requestView: "source" | "parsed"` 状态。解析视图按 `ParsedLogRequest` 的 `method`、`path`、`query`、`body` 和 `rawBody` 渲染文本行；每个参数行使用 `key: value`，不引入对象树。详情应答区显示原文，存在 `responseData` 时显示回填按钮。

清空按钮调用 `await onClear()`，只有返回 `true` 时才清除当前详情选择；失败时保留现有详情。按钮在没有日志时禁用。新增样式保持详情内容可滚动、长键值可换行，窄屏时操作按钮允许换行。

- [ ] **步骤 4：运行 renderer 测试验证通过**

运行：

```bash
node --import tsx --test test/renderer/log-panel.test.ts
```

预期：日志详情相关测试全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/components/LogPanel.tsx src/renderer/styles.css test/renderer/log-panel.test.ts
git commit -m "feat: improve log detail views"
```

### 任务 4：接入 App 清空回调和 JSON 一次性回填

**文件：**

- 修改：`src/renderer/App.tsx`、`src/renderer/components/JsonPreviewPage.tsx`
- 测试：`test/renderer/navigation.test.ts`、`test/renderer/json-preview.test.ts`

- [ ] **步骤 1：编写失败的 renderer 契约测试**

增加静态契约断言，要求 App 中存在 `clearLogs` IPC 调用、日志面板的 `onClear`/`onFillJson` 连接、`page === "json"` 的回填 props；JSON 页面包含 `prefillText`、`onPrefillApplied`、`useEffect` 和重新解析逻辑。

- [ ] **步骤 2：运行测试验证失败**

运行：

```bash
node --import tsx --test test/renderer/navigation.test.ts test/renderer/json-preview.test.ts
```

预期：新增回填和清空连接断言 FAIL。

- [ ] **步骤 3：实现 App 状态和页面回填**

App 增加：

```ts
const [jsonPrefill, setJsonPrefill] = useState<string>();

const clearLogs = async (): Promise<boolean> => {
  const result = await window.forwarder.clearLogs();
  if (!result.ok) {
    setError(result.error ?? "日志清空失败");
    return false;
  }
  setLogs([]);
  setError("");
  return true;
};

const fillJsonPreview = (text: string) => {
  setJsonPrefill(text);
  setPage("json");
};
```

将 `<LogPanel logs={logs} onClear={() => clearLogs()} onFillJson={fillJsonPreview} />` 接入，并将 `<JsonPreviewPage prefillText={jsonPrefill} onPrefillApplied={() => setJsonPrefill(undefined)} />` 接入。

JSON 页面 props 改为：

```ts
interface JsonPreviewPageProps {
  prefillText?: string;
  onPrefillApplied?: () => void;
}
```

用 `useEffect` 监听新的 `prefillText`，执行与 `updateInput` 一致的输入文本、解析结果、选中路径和展开路径重置；解析失败时仍保存原文。应用完成后调用 `onPrefillApplied` 清除一次性状态，避免普通页面刷新重复覆盖输入。

- [ ] **步骤 4：运行 renderer 测试验证通过**

运行：

```bash
node --import tsx --test test/renderer/navigation.test.ts test/renderer/json-preview.test.ts test/renderer/log-panel.test.ts
```

预期：导航、日志和 JSON 回填契约全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/JsonPreviewPage.tsx test/renderer/navigation.test.ts test/renderer/json-preview.test.ts
git commit -m "feat: refill JSON preview from logs"
```

### 任务 5：完整验证与交接

**文件：** 无新增业务文件；仅检查任务 1–4 的变更。

- [ ] **步骤 1：运行共享、核心、IPC 和 renderer 专项测试**

运行：

```bash
node --import tsx --test test/shared/log-details.test.ts test/core/runtime/forwarding-service.test.ts test/core/runtime/forwarding-service-manager.test.ts test/electron/ipc-contract.test.ts test/electron/preload-contract.test.ts test/renderer/log-panel.test.ts test/renderer/navigation.test.ts test/renderer/json-preview.test.ts
```

预期：所有专项测试 PASS，失败数为 0。

- [ ] **步骤 2：运行生产构建**

运行：

```bash
npm run build
```

预期：Electron、TypeScript 和 Vite 构建退出码为 0。

- [ ] **步骤 3：运行完整测试集**

运行：

```bash
npm test
```

预期：构建成功，所有测试 PASS，失败数为 0。

- [ ] **步骤 4：检查变更边界**

运行：

```bash
git diff --check
git status --short
```

预期：无空白错误；只报告本功能文件和工作树中原有的用户改动，不覆盖或清理其他改动。
