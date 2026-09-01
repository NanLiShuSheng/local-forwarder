# 主题设置实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（- [ ]）语法来跟踪进度。

**目标：** 在本地转发工具中增加全局“外观”页面，支持默认跟随系统、浅色和深色三种主题，并让侧栏与主内容区整体同步切换。

**架构：** renderer 使用一个无 React 依赖的主题状态工具保存和解析 system | light | dark，再由 useTheme 监听 macOS 的 prefers-color-scheme 并把解析后的主题传给 App。App 在根 .app-shell 上设置 data-theme，外观页面只修改 renderer 偏好，不新增 IPC 或代理配置字段。现有深色样式整理为 CSS 语义变量，浅色主题通过同一组变量覆盖。

**技术栈：** React、TypeScript、Electron renderer、CSS 自定义属性、浏览器 localStorage 与 matchMedia、Node test runner + tsx。

---

## 文件清单

- 创建：src/renderer/theme.ts — 主题模式类型、存储键、读取/写入和系统主题解析。
- 创建：src/renderer/useTheme.ts — renderer 侧 React hook，维护模式和系统主题变化。
- 创建：src/renderer/components/AppearancePage.tsx — 外观页面、三张主题卡片和说明。
- 修改：src/renderer/App.tsx — 接入 hook、增加外观导航、渲染外观页、设置 data-theme。
- 修改：src/renderer/components/ConfigPages.tsx — 扩展 Page 类型并排除 appearance。
- 修改：src/renderer/styles.css — 建立主题变量、浅色变量覆盖、业务组件主题化和外观页布局。
- 创建：test/renderer/theme.test.ts — 主题纯函数、页面结构和关键 CSS 契约测试。
- 修改：docs/WORK-PLAN.md — 记录主题设置完成项和验证命令。

当前 worktree 已有其他未提交改动。执行时只暂存上述主题相关文件，不能使用 git add .。

### 任务 1：建立主题核心状态模型

**文件：**
- 创建：src/renderer/theme.ts
- 创建：test/renderer/theme.test.ts

- [ ] **步骤 1：先编写会失败的主题纯函数测试**

在 test/renderer/theme.test.ts 中加入以下测试：

~~~ts
import assert from "node:assert/strict";
import test from "node:test";
import { THEME_STORAGE_KEY, isThemeMode, readThemeMode, resolveTheme, writeThemeMode } from "../../src/renderer/theme";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value,
  };
}

test("theme mode defaults to system and rejects invalid persisted values", () => {
  assert.equal(readThemeMode(storage(null)), "system");
  assert.equal(readThemeMode(storage("solarized")), "system");
  assert.equal(isThemeMode("light"), true);
  assert.equal(isThemeMode("dark"), true);
  assert.equal(isThemeMode("system"), true);
  assert.equal(isThemeMode("solarized"), false);
});

test("theme mode resolves explicit values and system values", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});

test("theme mode persists under the renderer-specific storage key", () => {
  const target = storage();
  writeThemeMode(target, "dark");
  assert.equal(target.value(), "dark");
  assert.equal(target.getItem(THEME_STORAGE_KEY), "dark");
});

test("theme storage failures fall back without throwing", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readThemeMode(broken), "system");
  assert.doesNotThrow(() => writeThemeMode(broken, "light"));
});
~~~

- [ ] **步骤 2：运行测试验证失败**

运行：

~~~bash
npx tsx --test test/renderer/theme.test.ts
~~~

预期：FAIL，报错无法解析 src/renderer/theme 的导出。

- [ ] **步骤 3：实现最小主题纯函数**

创建 src/renderer/theme.ts，提供测试使用的精确 API：

~~~ts
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "local-forwarder.theme-mode";

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemeMode(storage: ThemeStorage | undefined): ThemeMode {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : "system";
  } catch {
    return "system";
  }
}

export function writeThemeMode(storage: ThemeStorage | undefined, mode: ThemeMode): void {
  try { storage?.setItem(THEME_STORAGE_KEY, mode); } catch { /* optional storage */ }
}

export function resolveTheme(mode: ThemeMode, systemIsDark: boolean): ResolvedTheme {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemIsDark ? "dark" : "light";
}
~~~

不要在这个模块加载时访问 window 或 localStorage。

- [ ] **步骤 4：运行主题纯函数测试验证通过**

运行 npx tsx --test test/renderer/theme.test.ts，预期 4 个主题核心测试 PASS。

- [ ] **步骤 5：提交核心主题模型**

~~~bash
git add src/renderer/theme.ts test/renderer/theme.test.ts
git commit -m "feat: add theme mode state helpers"
~~~

### 任务 2：接入 React 状态与外观页面

**文件：**
- 创建：src/renderer/useTheme.ts
- 创建：src/renderer/components/AppearancePage.tsx
- 修改：src/renderer/App.tsx
- 修改：src/renderer/components/ConfigPages.tsx
- 修改：test/renderer/theme.test.ts

- [ ] **步骤 1：先加入页面和 hook 契约测试**

在 theme.test.ts 追加源码契约测试，检查外观导航、三种模式、根节点属性和系统监听：

~~~ts
import { readFile } from "node:fs/promises";

test("renderer exposes the appearance page and global theme root", async () => {
  const [app, appearance, hook] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/AppearancePage.tsx", "utf8").catch(() => ""),
    readFile("src/renderer/useTheme.ts", "utf8").catch(() => ""),
  ]);
  assert.match(app, /label: "外观"/);
  assert.match(app, /data-theme=\{theme\}/);
  assert.match(app, /AppearancePage/);
  for (const label of ["跟随系统", "浅色", "深色"]) assert.match(appearance, new RegExp(label));
  assert.match(hook, /prefers-color-scheme: dark/);
  assert.match(hook, /addEventListener\("change"/);
  assert.match(hook, /writeThemeMode/);
});
~~~

- [ ] **步骤 2：运行测试验证页面尚未实现**

运行 npx tsx --test test/renderer/theme.test.ts，预期新增契约测试 FAIL，任务 1 的纯函数测试仍 PASS。

- [ ] **步骤 3：实现 useTheme**

创建 src/renderer/useTheme.ts。用安全适配函数读取 localStorage 和 matchMedia；缺少浏览器能力时不阻塞应用启动，系统主题按深色回退。hook 必须监听 change 并在 cleanup 中移除监听：

~~~ts
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode(readThemeStorage()));
  const [systemIsDark, setSystemIsDark] = useState(readSystemTheme);
  const theme = resolveTheme(mode, systemIsDark);

  useEffect(() => {
    const query = getSystemThemeQuery();
    if (query === undefined) return;
    const onChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const updateMode = (next: ThemeMode) => {
    setMode(next);
    writeThemeMode(readThemeStorage(), next);
  };
  return { mode, theme, setMode: updateMode };
}
~~~

- [ ] **步骤 4：实现 AppearancePage**

创建 src/renderer/components/AppearancePage.tsx。页面包含“外观”标题、当前解析主题、即时生效提示和三张可聚焦主题卡片。卡片使用 button type="button"、aria-pressed、selected 类和主题预览色块；点击后调用 onModeChange。不要实现原型中仅用于示意的“减少动效”和“紧凑布局”。

核心结构：

~~~tsx
<section className="appearance-page">
  <div className="topbar">...</div>
  <div className="panel appearance-theme-panel">
    <div className="appearance-theme-grid">
      {themeOptions.map((option) => (
        <button
          key={option.mode}
          type="button"
          className={mode === option.mode ? "appearance-theme-card selected" : "appearance-theme-card"}
          aria-pressed={mode === option.mode}
          onClick={() => onModeChange(option.mode)}
        >...</button>
      ))}
    </div>
  </div>
</section>
~~~

- [ ] **步骤 5：接入 App 和 Page 路由**

在 App.tsx 中调用 useTheme，pages 增加 { id: "appearance", label: "外观" }，并把 data-theme={theme} 放在 .app-shell 根节点上。渲染条件要保证 appearance 不进入 ConfigPages：

~~~tsx
{page === "appearance" && <AppearancePage mode={mode} theme={theme} onModeChange={setMode} />}
{page !== "runtime" && page !== "rules" && page !== "logs" && page !== "appearance" && <ConfigPages page={page} {...pageProps} />}
~~~

在 ConfigPages.tsx 的 Page union 中加入 appearance。

- [ ] **步骤 6：运行页面契约和构建检查**

运行：

~~~bash
npx tsx --test test/renderer/theme.test.ts
npm run build
~~~

预期：主题测试全部 PASS，TypeScript 和 Vite 构建 PASS。

- [ ] **步骤 7：提交页面和状态接入**

~~~bash
git add src/renderer/useTheme.ts src/renderer/components/AppearancePage.tsx src/renderer/App.tsx src/renderer/components/ConfigPages.tsx test/renderer/theme.test.ts
git commit -m "feat: add appearance settings page"
~~~

### 任务 3：主题化现有 renderer 并补齐浅色皮肤

**文件：**
- 修改：src/renderer/styles.css
- 修改：test/renderer/theme.test.ts

- [ ] **步骤 1：先加入 CSS 主题契约测试**

追加以下测试：

~~~ts
test("renderer styles define synchronized light and dark theme tokens", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  assert.match(source, /\.app-shell\[data-theme="light"\]/);
  assert.match(source, /--app-background/);
  assert.match(source, /--sidebar-background/);
  assert.match(source, /--panel-background/);
  assert.match(source, /color-scheme:\s*light/);
  assert.match(source, /color-scheme:\s*dark/);
  assert.match(source, /\.sidebar[^\{]*\{[^}]*background:\s*var\(--sidebar-background\)/);
  assert.match(source, /\.content[^\{]*\{[^}]*background:\s*var\(--app-background\)/);
  assert.match(source, /\.appearance-theme-grid/);
});
~~~

- [ ] **步骤 2：运行测试验证样式契约失败**

运行 npx tsx --test test/renderer/theme.test.ts，预期 CSS 契约测试 FAIL，因为现有样式没有浅色变量、主题选择器和外观页面样式。

- [ ] **步骤 3：建立主题变量并替换共享布局颜色**

在 styles.css 顶部为 .app-shell 增加深色默认变量和 .app-shell[data-theme="light"] 浅色覆盖。至少包含：

~~~css
.app-shell {
  --app-background: #0d1421;
  --sidebar-background: rgb(8 15 27 / 92%);
  --sidebar-border: #26344b;
  --panel-background: rgb(17 29 48 / 82%);
  --surface-background: #14243a;
  --input-background: #111e32;
  --code-background: #0f1b2d;
  --text-primary: #e9eef7;
  --text-secondary: #91a5bf;
  --text-muted: #7387a3;
  --border-default: #2a3b55;
  --border-strong: #344862;
  --border-selected: #79e2c0;
  --selection-background: #1d2c43;
  --success: #79e2c0;
  --warning: #f3c67f;
  --danger: #f78383;
  color-scheme: dark;
  color: var(--text-primary);
  background: var(--app-background);
}

.app-shell[data-theme="light"] {
  --app-background: #f4f7fb;
  --sidebar-background: #e8eef5;
  --sidebar-border: #d7e1ec;
  --panel-background: rgb(255 255 255 / 92%);
  --surface-background: #f8fafc;
  --input-background: #ffffff;
  --code-background: #f0f4f8;
  --text-primary: #1c2b43;
  --text-secondary: #5f718a;
  --text-muted: #8291a6;
  --border-default: #d8e2ee;
  --border-strong: #c0cedd;
  --border-selected: #4fb092;
  --selection-background: #dcefe8;
  --success: #368d73;
  --warning: #b57622;
  --danger: #ba4b56;
  color-scheme: light;
}
~~~

将 .app-shell、.sidebar、.content、.panel、proxy-instance、sidebar-nav、form、request、string-tool、log、错误框和按钮等主题相关硬编码色替换为变量。保留尺寸、布局和现有深色默认外观，不重构与主题无关的规则。

- [ ] **步骤 4：补充外观页 CSS**

增加 appearance-page、appearance-theme-panel、appearance-theme-grid、appearance-theme-card、appearance-theme-preview 和说明提示样式。覆盖 hover、focus-visible、selected、disabled 语义；主题预览同时显示侧栏和内容区色块。沿用现有 panel、topbar、eyebrow、圆角和响应式断点，不引入第三方 UI。

- [ ] **步骤 5：运行 CSS 契约测试和构建**

运行：

~~~bash
npx tsx --test test/renderer/theme.test.ts
npm run build
~~~

预期：主题测试 PASS，TypeScript 检查和 Vite 构建 PASS。

- [ ] **步骤 6：提交主题样式**

~~~bash
git add src/renderer/styles.css test/renderer/theme.test.ts
git commit -m "feat: add light and dark theme tokens"
~~~

### 任务 4：全量验证并更新工作记录

**文件：**
- 修改：docs/WORK-PLAN.md

- [ ] **步骤 1：运行专项与全量测试**

运行：

~~~bash
npx tsx --test test/renderer/theme.test.ts
npm test
git diff --check HEAD~3..HEAD
~~~

预期：专项主题测试和全量测试 PASS，差异检查无输出。若 HEAD~3 不适用，改用 git diff --check 覆盖本轮主题提交，不能跳过差异检查。

- [ ] **步骤 2：检查主题行为覆盖**

确认以下行为均有源码或测试证据：首次启动为 system；显式浅色/深色不受系统变化覆盖；系统模式监听媒体查询；刷新后保留选择；主题切换不调用代理配置保存/启停接口；侧栏和内容区都使用变量。

- [ ] **步骤 3：更新工作记录**

在 docs/WORK-PLAN.md 的已完成部分增加一条主题设置记录，写明外观页面、三种模式、全局侧栏同步、localStorage 持久化、专项测试和全量测试结果。只修改主题相关段落，不重排已有改动。

- [ ] **步骤 4：提交工作记录**

~~~bash
git add docs/WORK-PLAN.md
git commit -m "docs: record theme settings verification"
~~~

- [ ] **步骤 5：最终状态检查**

运行：

~~~bash
git status --short
git log -4 --oneline
~~~

预期：主题相关提交可见；其他既有未提交改动仍保持原状，不被本功能提交吸收。

## 计划自检

- 规格中的三种模式、默认跟随系统、持久化、系统变化监听、整套界面同步、即时生效、错误回退、无 IPC 变更和测试范围，分别由任务 1～4 覆盖。
- 已检查占位词和模糊步骤；源码变更步骤都给出了目标文件、API、选择器或结构代码，命令包含预期结果。
- ThemeMode、ResolvedTheme、readThemeMode、writeThemeMode、resolveTheme、useTheme、AppearancePage 和 Page 的名称在任务间保持一致。
- “减少动效”和“紧凑布局”明确排除，避免把原型装饰误实现为功能。
