# 日志类型筛选记忆实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将日志类型下拉框的手动选择保存到 localStorage；无保存值时仍默认 `/reqxml`。

**架构：** 在 renderer 中新增无 UI 依赖的日志类型偏好模块，复用现有主题偏好的 storage adapter 约定。`LogPanel` 挂载时惰性读取偏好，用户改变类型时同步更新 React 状态并写回 localStorage；存储不可用时仅降级为当前页面行为，不影响日志筛选。

**技术栈：** TypeScript、React hooks、浏览器 localStorage、Node `node:test`、tsx、现有 Vite/Electron 构建链。

---

## 文件清单

- 创建：`src/renderer/log-type-preference.ts` — 存储键、默认值、storage adapter、偏好读写和异常降级。
- 创建：`test/renderer/log-type-preference.test.ts` — 偏好读写及 localStorage 异常边界测试。
- 修改：`src/renderer/components/LogPanel.tsx` — 从本地存储初始化类型，并在手动选择时保存。
- 修改：`test/renderer/log-panel.test.ts` — 验证面板接入读写 helper，并保留已有筛选断言。

`LogPanel.tsx` 和 `test/renderer/log-panel.test.ts` 当前包含用户既有未提交改动。实现时只追加本需求的 hunk，不使用 `git reset`、`git checkout --` 或整文件覆盖；这两个文件不单独暂存提交。

## 任务 0：确认工作树边界

**文件：** 无文件修改。

- [ ] **步骤 1：记录当前状态并检查重叠文件**

  运行：

  ```bash
  git status --short
  git diff -- src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
  ```

  预期：确认两个重叠文件存在用户改动；后续只保留这些改动并追加持久化逻辑。

- [ ] **步骤 2：确认规格和计划提交**

  运行：

  ```bash
  git log -2 --oneline -- docs/superpowers/specs/2026-09-17-persist-log-type-filter-design.md docs/superpowers/plans/2026-09-17-persist-log-type-filter.md
  ```

  预期：规格提交为 `afe9014`，计划提交完成后紧随其后；实现以规格中的 `local-forwarder.log-type` 和 `/reqxml` 默认值为准。

## 任务 1：实现可测试的日志类型偏好存储

**文件：**

- 创建：`test/renderer/log-type-preference.test.ts`
- 创建：`src/renderer/log-type-preference.ts`

- [ ] **步骤 1：先编写失败测试**

  创建测试，使用真实的内存 storage adapter 验证键、默认值、round-trip 和异常降级：

  ```ts
  import assert from "node:assert/strict";
  import test from "node:test";
  import {
    DEFAULT_LOG_TYPE,
    LOG_TYPE_STORAGE_KEY,
    readLogType,
    writeLogType,
    type LogTypeStorage,
  } from "../../src/renderer/log-type-preference";

  function statefulStorage(initial: string | null): LogTypeStorage {
    let value = initial;
    return {
      getItem: (key) => key === LOG_TYPE_STORAGE_KEY ? value : null,
      setItem: (key, next) => {
        if (key === LOG_TYPE_STORAGE_KEY) value = next;
      },
    };
  }

  test("uses reqxml when the stored type is missing or empty", () => {
    assert.equal(readLogType(statefulStorage(null)), DEFAULT_LOG_TYPE);
    assert.equal(readLogType(statefulStorage("   ")), DEFAULT_LOG_TYPE);
  });

  test("round-trips all and dynamic log types", () => {
    const storage = statefulStorage(null);
    writeLogType(storage, "all");
    assert.equal(readLogType(storage), "all");
    writeLogType(storage, "/api/data");
    assert.equal(readLogType(storage), "/api/data");
  });

  test("falls back when storage access throws", () => {
    const storage: LogTypeStorage = {
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
    };
    assert.equal(readLogType(storage), DEFAULT_LOG_TYPE);
    assert.doesNotThrow(() => writeLogType(storage, "/reqreadmap"));
  });

  test("supports an absent storage adapter", () => {
    assert.equal(readLogType(undefined), DEFAULT_LOG_TYPE);
    assert.doesNotThrow(() => writeLogType(undefined, "/reqreadmap"));
  });
  ```

- [ ] **步骤 2：运行测试确认因模块缺失而失败**

  运行：

  ```bash
  npx tsx --test test/renderer/log-type-preference.test.ts
  ```

  预期：FAIL，报告 `src/renderer/log-type-preference` 尚不存在；失败原因应是模块缺失，而不是测试语法错误。

- [ ] **步骤 3：编写最少的偏好模块**

  创建 `src/renderer/log-type-preference.ts`：

  ```ts
  export const DEFAULT_LOG_TYPE = "/reqxml" as const;
  export const LOG_TYPE_STORAGE_KEY = "local-forwarder.log-type";

  export interface LogTypeStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  }

  export function getLogTypeStorage(): LogTypeStorage | undefined {
    if (typeof window === "undefined") return undefined;
    try {
      const storage = window.localStorage;
      if (storage === undefined) return undefined;
      return {
        getItem: (key) => {
          try {
            return storage.getItem(key);
          } catch {
            return null;
          }
        },
        setItem: (key, value) => {
          try {
            storage.setItem(key, value);
          } catch {
            // localStorage is optional in restricted browser contexts.
          }
        },
      };
    } catch {
      return undefined;
    }
  }

  export function readLogType(storage: LogTypeStorage | undefined): string {
    try {
      const value = storage?.getItem(LOG_TYPE_STORAGE_KEY)?.trim();
      return value || DEFAULT_LOG_TYPE;
    } catch {
      return DEFAULT_LOG_TYPE;
    }
  }

  export function writeLogType(storage: LogTypeStorage | undefined, value: string): void {
    try {
      storage?.setItem(LOG_TYPE_STORAGE_KEY, value);
    } catch {
      // Persistence is best effort and must not block log filtering.
    }
  }
  ```

- [ ] **步骤 4：运行偏好测试确认通过**

  运行：

  ```bash
  npx tsx --test test/renderer/log-type-preference.test.ts
  ```

  预期：4 个测试全部 PASS，覆盖默认值、`all`/动态 pathname、异常和无 adapter。

- [ ] **步骤 5：仅提交新增的 helper 与测试**

  运行：

  ```bash
  git add src/renderer/log-type-preference.ts test/renderer/log-type-preference.test.ts
  git diff --cached --check
  git commit -m "feat(renderer): persist log type preference"
  ```

  预期：只提交这两个新文件；不要暂存 `LogPanel.tsx` 或其既有测试文件。

## 任务 2：接入 LogPanel 的初始化和手动保存

**文件：**

- 修改：`src/renderer/components/LogPanel.tsx:1-98`
- 修改：`test/renderer/log-panel.test.ts:1-175`

- [ ] **步骤 1：先增加 renderer 接线失败测试**

  在现有类型筛选测试中读取 `LogPanel.tsx` 源码，并增加以下断言：

  ```ts
  assert.match(panelSource, /readLogType/);
  assert.match(panelSource, /writeLogType/);
  assert.match(panelSource, /getLogTypeStorage/);
  assert.match(panelSource, /useState\(\(\) => readLogType\(logTypeStorage\)\)/);
  assert.match(panelSource, /writeLogType\(logTypeStorage, nextType\)/);
  ```

  同时把已有的默认断言从 `useState("/reqxml")` 改为检查 `DEFAULT_LOG_TYPE` 或 `readLogType`，以表达“无保存值时默认 `/reqxml`”而不是绑定旧的实现写法。

- [ ] **步骤 2：运行 renderer 测试确认红灯**

  运行：

  ```bash
  npx tsx --test test/renderer/log-panel.test.ts
  ```

  预期：新增接线断言 FAIL，提示面板尚未引用偏好读写；已有筛选、详情和清空测试保持通过。

- [ ] **步骤 3：写入最小接线代码**

  在 `LogPanel.tsx` 中增加导入：

  ```ts
  import { getLogTypeStorage, readLogType, writeLogType } from "../log-type-preference";
  ```

  在组件内类型状态之前创建稳定的 storage adapter，并使用惰性状态初始化：

  ```tsx
  const logTypeStorage = useMemo(() => getLogTypeStorage(), []);
  const [logType, setLogType] = useState(() => readLogType(logTypeStorage));
  ```

  保留 `getLogTypeOptions` 和 `resolveLogTypeSelection` 的既有回退逻辑；类型下拉框的 change handler 改为同时更新状态和本地存储：

  ```tsx
  onChange={(event) => {
    const nextType = event.target.value;
    setLogType(nextType);
    writeLogType(logTypeStorage, nextType);
  }}
  ```

  不增加 effect、IPC、配置字段或 CSS；存储读取失败时 `readLogType` 返回 `/reqxml`，写入失败时当前筛选仍已由 `setLogType` 更新。

- [ ] **步骤 4：运行 renderer 定向测试确认绿灯**

  运行：

  ```bash
  npx tsx --test test/renderer/log-type-preference.test.ts test/renderer/log-panel.test.ts
  ```

  预期：偏好测试和日志面板测试全部 PASS；静态渲染仍包含“全部”、固定类型和动态路径，既有详情/清空/JSON 回填行为不变。

- [ ] **步骤 5：检查重叠文件差异边界**

  运行：

  ```bash
  git diff --check -- src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
  git diff --stat -- src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
  ```

  预期：无空白错误；差异中保留用户既有 LogPanel 行为，只新增偏好读写接线和测试断言；不执行覆盖式回退。

## 任务 3：完成整体验证

**文件：** 无新增文件；仅运行验证命令。

- [ ] **步骤 1：运行 renderer 全部测试**

  运行：

  ```bash
  npx tsx --test $(rg --files test/renderer -g '*.test.ts' | sort)
  ```

  预期：所有 renderer 测试通过，失败数为 0。

- [ ] **步骤 2：运行生产构建**

  运行：

  ```bash
  npm run build
  ```

  预期：Electron TypeScript 检查、renderer 类型检查和 Vite 构建退出码均为 0。

- [ ] **步骤 3：运行完整测试**

  运行：

  ```bash
  npm test
  ```

  预期：构建和全量测试完成，`fail 0`、`cancelled 0`。

- [ ] **步骤 4：确认差异和工作树边界**

  运行：

  ```bash
  git diff --check
  git status --short
  git diff -- src/renderer/components/LogPanel.tsx test/renderer/log-panel.test.ts
  ```

  预期：无空白错误；新增 helper 已在独立提交中，LogPanel 相关改动与用户原有未提交改动一起保留，未修改其他文件。
