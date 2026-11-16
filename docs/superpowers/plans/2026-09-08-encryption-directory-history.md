# 加密目录历史选择实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为加密前目录和加密后目录分别增加可持久化、可下拉选择的最近目录历史。

**架构：** 在现有加密偏好文件中保存 `inputHistory` 和 `outputHistory`，由核心偏好层负责清洗、去重、限制数量和旧数据迁移。Renderer 复用转发地址的历史箭头、菜单和选项样式，通过现有 `encryption:save-preferences` IPC 记录系统选择、手动输入和历史选择。

**技术栈：** TypeScript、React、Electron IPC、Node 内置 `node:test`、tsx、Vite。

---

## 文件清单

- 修改：`src/core/encryption/preferences.ts` — 偏好结构、历史清洗、迁移和保存逻辑。
- 修改：`test/core/encryption/preferences.test.ts` — 偏好历史的失败测试和回归测试。
- 修改：`src/shared/contracts.ts` — 共享 `EncryptionPreferences` 类型。
- 修改：`src/renderer/App.tsx` — 新偏好结构的初始值和状态回退值。
- 修改：`src/renderer/components/ConfigPages.tsx` — 两个目录字段的历史状态、下拉菜单、选择和关闭行为。
- 修改：`src/renderer/styles.css` — 加密目录输入壳层和历史菜单定位样式，复用转发地址历史视觉样式。
- 修改：`test/renderer/encryption-panel.test.ts` — 加密目录历史交互的 Renderer 合同测试。
- 检查：`electron/main.ts`、`electron/preload.ts`、`test/electron/encryption-contract.test.ts`、`test/electron/preload-contract.test.ts` — 确认不新增 IPC channel，编译后的 API 仍完整。

## 设计约束

- 历史分别保存最近 10 条非空路径，最新使用项在最前，重复项只保留一条。
- 当前目录读取仍要求目录存在；历史项不做存在性过滤，选中后由现有加密任务校验目录。
- IPC 保存调用方只提交 `inputDir` 或 `outputDir`，历史数组由偏好层生成。
- 不改变 `parseDirectoryInput`、目录选择取消行为、加密目录安全校验和全量/增量加密逻辑。

### 任务 1：持久化加密目录历史

**文件：**
- 修改：`test/core/encryption/preferences.test.ts`
- 修改：`src/core/encryption/preferences.ts`

- [ ] **步骤 1：先写失败的偏好历史测试**

在现有“缺少偏好时为空”和“合并前后目录”测试的期望值中加入两个空历史数组，并追加以下行为测试：

```ts
test("keeps input and output histories separate, newest first, unique, and capped at ten", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-history-"));
  const preferencesPath = path.join(root, "preferences.json");
  const inputDirs = Array.from({ length: 11 }, (_, index) => path.join(root, `input-${index}`));
  const outputDirs = Array.from({ length: 2 }, (_, index) => path.join(root, `output-${index}`));
  await Promise.all([...inputDirs, ...outputDirs].map((directory) => mkdir(directory)));
  try {
    for (const inputDir of inputDirs) await saveEncryptionPreferences(preferencesPath, { inputDir });
    for (const outputDir of outputDirs) await saveEncryptionPreferences(preferencesPath, { outputDir });
    const expectedInputHistory = [...inputDirs].reverse().slice(0, 10);
    assert.deepEqual((await readEncryptionPreferences(preferencesPath)).inputHistory, expectedInputHistory);
    assert.deepEqual((await readEncryptionPreferences(preferencesPath)).outputHistory, [...outputDirs].reverse());

    await saveEncryptionPreferences(preferencesPath, { inputDir: inputDirs[5] });
    const restored = await readEncryptionPreferences(preferencesPath);
    assert.deepEqual(restored.inputHistory, [inputDirs[5], ...expectedInputHistory.filter((directory) => directory !== inputDirs[5])]);
    assert.deepEqual(restored.outputHistory, [...outputDirs].reverse());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrates existing current directories into history and preserves deleted historical paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-encryption-history-"));
  const preferencesPath = path.join(root, "preferences.json");
  const inputDir = path.join(root, "input");
  const outputDir = path.join(root, "output");
  const deletedHistory = path.join(root, "deleted-history");
  await mkdir(inputDir);
  await mkdir(outputDir);
  try {
    await writeFile(preferencesPath, JSON.stringify({ inputDir, outputDir }), "utf8");
    assert.deepEqual(await readEncryptionPreferences(preferencesPath), {
      inputDir,
      outputDir,
      inputHistory: [inputDir],
      outputHistory: [outputDir],
    });
    await saveEncryptionPreferences(preferencesPath, { inputDir: deletedHistory });
    const restored = await readEncryptionPreferences(preferencesPath);
    assert.equal(restored.inputDir, "");
    assert.equal(restored.inputHistory[0], deletedHistory);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **步骤 2：运行核心测试确认红灯**

运行：

```bash
npx tsx --test test/core/encryption/preferences.test.ts
```

预期：失败，现有返回值缺少 `inputHistory`/`outputHistory`，且保存逻辑不会记录历史；不要修改测试来迎合现有实现。

- [ ] **步骤 3：实现最少的偏好历史逻辑**

在 `src/core/encryption/preferences.ts` 增加统一清洗函数，并让读取和保存都使用它：

```ts
const HISTORY_LIMIT = 10;
const emptyPreferences: EncryptionPreferences = {
  inputDir: "",
  outputDir: "",
  inputHistory: [],
  outputHistory: [],
};

function normalizeHistory(value: unknown, currentDir = ""): string[] {
  const values = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return [...new Set([currentDir, ...values].map((entry) => entry.trim()).filter((entry) => entry.length > 0))].slice(0, HISTORY_LIMIT);
}

function addHistory(history: string[], value: string): string[] {
  return normalizeHistory([value, ...history]);
}
```

读取时先规范化当前目录，再将它传给 `normalizeHistory(parsed.inputHistory, inputDir)`；保存时只在对应 patch 字段为字符串时调用 `addHistory`，另一个目录和历史原样保留。`readEncryptionPreferences` 对缺失历史字段使用空数组，对非字符串元素过滤。

- [ ] **步骤 4：运行核心测试确认绿灯**

运行：

```bash
npx tsx --test test/core/encryption/preferences.test.ts
```

预期：该文件中的全部测试通过，且 JSON 文件同时包含当前目录和两个历史数组。

- [ ] **步骤 5：提交偏好层变更**

```bash
git add src/core/encryption/preferences.ts test/core/encryption/preferences.test.ts
git commit -m "feat: persist encryption directory history"
```

### 任务 2：扩展共享偏好类型并补充 Renderer 红灯测试

**文件：**
- 修改：`test/renderer/encryption-panel.test.ts`
- 修改：`src/shared/contracts.ts`
- 修改：`src/renderer/App.tsx`

- [ ] **步骤 1：先添加 Renderer 历史交互合同测试**

在 `test/renderer/encryption-panel.test.ts` 追加一个只检查需求行为的测试：

```ts
test("encryption directory fields expose independent history controls", async () => {
  const source = await readFile("src/renderer/components/ConfigPages.tsx", "utf8");
  const styles = await readFile("src/renderer/styles.css", "utf8");
  assert.match(source, /inputHistory/);
  assert.match(source, /outputHistory/);
  assert.match(source, /encryption-history-toggle/);
  assert.match(source, /encryption-history-menu/);
  assert.match(source, /encryption-history-option/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /saveEncryptionDirectory\(kind, directory\)/);
  assert.match(styles, /\.encryption-input-shell/);
});
```

- [ ] **步骤 2：运行 Renderer 测试确认红灯**

运行：

```bash
npx tsx --test test/renderer/encryption-panel.test.ts
```

预期：新增测试失败，因为组件还没有两个历史数据源、菜单和选择回调。

- [ ] **步骤 3：更新共享类型和 App 初始值**

在 `src/shared/contracts.ts` 将接口更新为：

```ts
export interface EncryptionPreferences {
  inputDir: string;
  outputDir: string;
  inputHistory: string[];
  outputHistory: string[];
}
```

在 `src/renderer/App.tsx` 将初始值和保存结果回退值都保证包含数组：

```ts
const initialEncryptionPreferences: EncryptionPreferences = {
  inputDir: "",
  outputDir: "",
  inputHistory: [],
  outputHistory: [],
};
```

`saveEncryptionPreferences` 使用主进程返回的完整 `preferences`；只有在返回值缺失时，才使用 `{ ...encryptionPreferences, ...patch }`，因此已有历史不会被手动输入覆盖。

- [ ] **步骤 4：运行类型检查确认共享接口可编译**

运行：

```bash
npx tsc -p tsconfig.json --noEmit
```

预期：类型检查通过；如果组件尚未读取新字段，不应出现未初始化数组的错误。

### 任务 3：实现加密目录历史下拉交互

**文件：**
- 修改：`src/renderer/components/ConfigPages.tsx`
- 修改：`src/renderer/styles.css`
- 测试：`test/renderer/encryption-panel.test.ts`

- [ ] **步骤 1：增加按目录类型读取历史的纯函数和组件状态**

在 `ConfigPages.tsx` 增加明确的目录类型映射，避免两个字段共享历史：

```ts
export function encryptionDirectoryHistoryForKind(
  preferences: EncryptionPreferences,
  kind: EncryptionDirectoryKind,
): string[] {
  return kind === "input" ? preferences.inputHistory : preferences.outputHistory;
}
```

在 `ConfigPages` 中新增：

```ts
const [openEncryptionHistoryKind, setOpenEncryptionHistoryKind] = useState<EncryptionDirectoryKind>();

const selectEncryptionHistory = (kind: EncryptionDirectoryKind, directory: string) => {
  setOpenEncryptionHistoryKind(undefined);
  void saveEncryptionDirectory(kind, directory);
};
```

输入框外点击监听扩展为同时识别 `.address-input-shell` 和 `.encryption-input-shell`，点击其他位置时关闭两个历史菜单；加密任务运行时关闭菜单并禁用历史按钮。

- [ ] **步骤 2：将两个加密字段改为带历史菜单的相同结构**

保留现有“选择加密前目录”和“选择加密后目录”按钮，在各自输入框内部增加历史按钮和菜单。每个字段的核心结构如下，`kind`、`value`、中文标签和选择按钮文案按 input/output 传入：

```tsx
<div className="input-with-button">
  <div className="encryption-input-shell">
    <input
      className="encryption-directory-input"
      disabled={encryptionRunning}
      value={value}
      onChange={(event) => setDirectoryValue(kind, event.target.value)}
      onBlur={() => void saveEncryptionDirectory(kind, value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void saveEncryptionDirectory(kind, value);
        }
      }}
    />
    <button
      type="button"
      className="address-history-toggle encryption-history-toggle"
      aria-label={`显示${label}历史`}
      aria-expanded={openEncryptionHistoryKind === kind}
      disabled={encryptionRunning || history.length === 0}
      onClick={() => setOpenEncryptionHistoryKind((current) => current === kind ? undefined : kind)}
    >
      <span className="address-history-chevron" aria-hidden="true" />
    </button>
    {openEncryptionHistoryKind === kind && <div className="address-history-menu encryption-history-menu" role="listbox" aria-label={`${label}历史目录`}>
      {history.map((directory) => <button
        type="button"
        role="option"
        aria-selected={value === directory}
        className="address-history-option encryption-history-option"
        key={directory}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => selectEncryptionHistory(kind, directory)}
      >{directory}</button>)}
    </div>}
  </div>
  <button type="button" disabled={encryptionRunning} onClick={() => void chooseEncryptionDirectory(kind)}>{chooseLabel}</button>
</div>
```

`setDirectoryValue` 只更新对应的 `encryptionInputDir` 或 `encryptionOutputDir`。历史选择必须调用现有 `saveEncryptionDirectory`，不能直接只改 React state，以保证历史被主进程偏好层记录。

- [ ] **步骤 3：补充加密输入壳层样式并复用历史视觉**

在 `src/renderer/styles.css` 增加以下最小布局规则；箭头、菜单和选项的颜色、焦点和阴影继续由现有 `.address-history-*` 规则提供：

```css
.encryption-input-shell { position: relative; min-width: 0; flex: 1; }
.encryption-directory-input { width: 100%; padding-right: 42px !important; }
.encryption-history-menu { left: 0; right: 0; width: auto; }
.encryption-history-option { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
```

确保原有 `.input-with-button input { flex: 1; }` 不再依赖嵌套输入框，历史按钮不会挤压“选择目录”按钮；小窗口下仍允许路径输入框收缩。

- [ ] **步骤 4：运行 Renderer 测试确认绿灯**

运行：

```bash
npx tsx --test test/renderer/encryption-panel.test.ts test/renderer/address-config.test.ts
```

预期：加密历史新增测试、原有加密页面测试和转发地址历史测试全部通过。

- [ ] **步骤 5：提交 Renderer 变更**

```bash
git add src/shared/contracts.ts src/renderer/App.tsx src/renderer/components/ConfigPages.tsx src/renderer/styles.css test/renderer/encryption-panel.test.ts
git commit -m "feat: add encryption directory history picker"
```

### 任务 4：Electron 边界与全量验证

**文件：**
- 检查：`electron/main.ts`
- 检查：`electron/preload.ts`
- 检查：`test/electron/encryption-contract.test.ts`
- 检查：`test/electron/preload-contract.test.ts`

- [ ] **步骤 1：确认现有 IPC 仍只接收当前目录字段**

检查主进程保存参数白名单仍为 `inputDir`、`outputDir`，并确认 `selectEncryptionDirectory` 和手动保存都调用 `saveEncryptionPreferences`。不新增历史 IPC channel；主进程收到核心偏好层返回的四字段对象后原样返回 Renderer。

- [ ] **步骤 2：构建 Electron 入口并运行边界测试**

运行：

```bash
npm run build:electron
npx tsx --test test/electron/encryption-contract.test.ts test/electron/preload-contract.test.ts
```

预期：Electron 编译成功，IPC channel、编码器资源和编译后 preload 合同测试通过。

- [ ] **步骤 3：运行全量测试和构建**

运行：

```bash
npm test
npm run build
git diff --check
```

预期：`npm test` 和 `npm run build` 退出码为 0，所有测试通过，`git diff --check` 无输出。

- [ ] **步骤 4：核对变更范围并提交剩余修正**

运行：

```bash
git diff --stat HEAD~2..HEAD
git status --short
```

确认新增提交只包含规格、核心偏好、共享类型、Renderer 历史交互和对应测试；当前工作树中原有的其他未提交修改不得被清理或覆盖。若前述步骤因类型或样式问题产生修正，使用：

```bash
git add src/core/encryption/preferences.ts test/core/encryption/preferences.test.ts src/shared/contracts.ts src/renderer/App.tsx src/renderer/components/ConfigPages.tsx src/renderer/styles.css test/renderer/encryption-panel.test.ts
git commit -m "fix: align encryption directory history checks"
```
