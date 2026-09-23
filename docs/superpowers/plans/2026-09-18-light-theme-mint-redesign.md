# 浅色主题「清透薄荷」视觉重设计实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 在不改变页面结构、交互和深色主题的前提下，将浅色主题从冷灰白改为更接近纯白的「清透薄荷」配色，并补齐边框、阴影、选中态和可访问性验证。

**架构：** 继续使用现有 `styles.css` 的 CSS custom properties 作为唯一主题入口。浅色主题只替换自身 token，并用浅色作用域覆盖面板阴影和实例选中边框；React 组件 DOM、主题解析和业务逻辑不变。主题契约测试从 CSS 中读取浅色规则，锁定核心色值与交互状态选择器。

**技术栈：** React、TypeScript、CSS custom properties、Node `node:test`、Vite。

---

## 文件清单

- 修改：`src/renderer/styles.css` — 浅色主题 token、浅色主题的背景/阴影/实例选中态覆盖。
- 修改：`test/renderer/theme.test.ts` — 锁定批准的清透薄荷色板、浅色背景规则和组件状态契约。
- 不修改：`src/renderer/App.tsx`、`src/renderer/components/AppearancePage.tsx`、`src/renderer/theme.ts` — 本次不改变页面结构或主题切换逻辑。

实现时只暂存上面两个文件；当前 worktree 中已有的其他未提交改动必须保持原样。

## 任务 1：先锁定浅色主题契约并验证当前实现失败

**文件：**

- 修改：`test/renderer/theme.test.ts`，放在现有 `styles define independent light and dark theme scopes and tokens` 测试之后。
- 测试：`test/renderer/theme.test.ts`

- [ ] **步骤 1：添加批准色板的失败测试**

在已有 `extractCssRule`、`extractCssToken` 辅助函数可用的范围内加入以下测试。`#5B726C` 用于小号次要文字，是原型中青灰文字的可访问性加深值；它保留同一色相并满足现有浅色背景的 AA 检查。

```ts
test("light theme uses the approved clear mint palette", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const expectedTokens: Record<string, string> = {
    "app-background": "#fcfefd",
    "app-background-accent": "#ffffff",
    "app-background-mid": "#f7fcfa",
    "sidebar-background": "#f2faf7",
    "sidebar-border": "#dbece7",
    "panel-background": "#ffffff",
    "surface-background": "#ffffff",
    "surface-alt-background": "#f7fcfa",
    "surface-subtle-background": "#f4fbf8",
    "surface-elevated-background": "#ffffff",
    "surface-selected-background": "#e4f5ef",
    "surface-code-background": "#f8fcfa",
    "input-background": "#ffffff",
    "code-background": "#f7fcfa",
    "code-surface-background": "#ffffff",
    "text-primary": "#17332f",
    "text-bright": "#13302c",
    "text-secondary": "#5b726c",
    "text-muted": "#5b726c",
    "text-label": "#5b726c",
    "text-subtle": "#5b726c",
    "text-tertiary": "#2e584c",
    "text-code": "#31564b",
    "text-description": "#5b726c",
    "border-default": "#d7e9e3",
    "border-card": "#d1e6df",
    "border-strong": "#c8e1d9",
    "border-button": "#c8e1d9",
    "border-input": "#d4e7e1",
    "border-field": "#e0eee9",
    "border-subtle": "#e4efeb",
    "border-hover": "#55a892",
    "border-selected": "#247c67",
    "selection-background": "#e4f5ef",
    "success": "#247c67",
    "text-success": "#217660",
    "success-hover": "#1f6f5c",
    "focus-ring": "#247c67",
  };

  for (const [token, expected] of Object.entries(expectedTokens)) {
    assert.equal(extractCssToken(lightRule, token), expected, `unexpected light token: ${token}`);
  }
  assert.match(lightRule, /background:\s*var\(--app-background\)/);
  assert.match(lightRule, /color-scheme:\s*light/);
});
```

- [ ] **步骤 2：添加浅色状态层级的失败测试**

继续在同一测试文件加入以下契约，确保浅色主题确实使用轻阴影，并让当前实例边框与导航激活线可以分别表达 `#55A892` 和 `#247C67`：

```ts
test("light theme keeps surfaces white and makes selected states distinct", async () => {
  const source = await readFile("src/renderer/styles.css", "utf8");
  const lightRule = extractCssRule(source, ".app-shell[data-theme=\"light\"]");
  const panelRule = source.match(/\.app-shell\[data-theme=\"light\"\][^{]*\.panel[^{]*\{[^}]*\}/s)?.[0] ?? "";
  const selectedInstanceRule = source.match(/\.app-shell\[data-theme=\"light\"\][^{]*\.proxy-instance-sidebar-card\.selected[^{]*\{[^}]*\}/s)?.[0] ?? "";

  assert.equal(extractCssToken(lightRule, "surface-background"), "#ffffff");
  assert.equal(extractCssToken(lightRule, "surface-selected-background"), "#e4f5ef");
  assert.match(panelRule, /box-shadow:\s*0\s+10px\s+26px\s+var\(--shadow-color\)/);
  assert.match(selectedInstanceRule, /border-color:\s*var\(--border-hover\)/);
});
```

- [ ] **步骤 3：运行新增测试确认它们先失败**

运行：

```bash
npx tsx --test test/renderer/theme.test.ts
```

预期：已有主题逻辑测试通过，但新增测试失败，至少应显示当前浅色 `app-background` 为 `#f4f7fb` 而不是 `#fcfefd`。如果新增测试未失败，先检查测试是否读取了实际 `src/renderer/styles.css`，不要修改测试预期来掩盖未覆盖的 CSS。

- [ ] **步骤 4：提交测试契约**

```bash
git add test/renderer/theme.test.ts
git commit -m "test: lock clear mint light theme palette"
```

## 任务 2：实现清透薄荷浅色主题与状态层级

**文件：**

- 修改：`src/renderer/styles.css:86-152` 浅色主题 token 块。
- 修改：`src/renderer/styles.css` 中浅色主题预览色、面板阴影和实例选中态规则。

- [ ] **步骤 1：替换浅色主题 token 块**

保留 `.app-shell` 的深色 token 原样，把 `.app-shell[data-theme="light"]` 中的主题 token 替换为以下实现值；警告、错误、信息和滚动条语义沿用现有值，避免扩大本次范围：

```css
.app-shell[data-theme="light"] {
  --app-background: #fcfefd;
  --app-background-accent: #ffffff;
  --app-background-mid: #f7fcfa;
  --sidebar-background: #f2faf7;
  --sidebar-border: #dbece7;
  --panel-background: #ffffff;
  --surface-background: #ffffff;
  --surface-alt-background: #f7fcfa;
  --surface-subtle-background: #f4fbf8;
  --surface-elevated-background: #ffffff;
  --surface-selected-background: #e4f5ef;
  --surface-code-background: #f8fcfa;
  --input-background: #ffffff;
  --code-background: #f7fcfa;
  --code-surface-background: #ffffff;
  --text-primary: #17332f;
  --text-bright: #13302c;
  --text-secondary: #5b726c;
  --text-muted: #5b726c;
  --text-label: #5b726c;
  --text-subtle: #5b726c;
  --text-tertiary: #2e584c;
  --text-code: #31564b;
  --text-disabled: #8da39b;
  --text-on-accent: #ffffff;
  --text-button: #2e584c;
  --border-default: #d7e9e3;
  --border-card: #d1e6df;
  --border-strong: #c8e1d9;
  --border-button: #c8e1d9;
  --border-input: #d4e7e1;
  --border-field: #e0eee9;
  --border-subtle: #e4efeb;
  --border-hover: #55a892;
  --border-selected: #247c67;
  --selection-background: #e4f5ef;
  --success: #247c67;
  --text-success: #217660;
  --text-description: #5b726c;
  --success-hover: #1f6f5c;
  --success-soft: rgb(36 124 103 / 12%);
  --success-faint: rgb(36 124 103 / 13%);
  --focus-background: rgb(36 124 103 / 10%);
  --focus-ring: #247c67;
  --warning: #8a5a00;
  --danger: #c33d4d;
  --danger-text: #a93545;
  --danger-strong-text: #a93545;
  --danger-border: #e0aab2;
  --danger-background: #fff1f3;
  --danger-hover-background: #fbe1e5;
  --scrollbar-track: #eef2f6;
  --scrollbar-thumb: #b4c1d0;
  --shadow-color: rgb(36 91 79 / 6%);
  --shadow-menu: rgb(36 91 79 / 14%);
  --shadow-strong: rgb(36 91 79 / 18%);
  --info: #256da8;
  --info-background: #eaf3fb;
  --progress-end: #3b9acb;
  --disabled-border: #a9b6c5;
  --disabled-text: #52647b;
  --inverse: #152033;
  --project-gradient-start: #ffffff;
  --project-gradient-end: #f4fbf8;
  --preview-shadow: rgb(23 51 47 / 10%);
  color-scheme: light;
  background: var(--app-background);
}
```

`--text-secondary`、`--text-muted`、`--text-label` 和 `--text-subtle` 使用 `#5B726C` 而不是原型中更浅的辅助文字，以满足现有 `theme.test.ts` 对浅色背景的 AA 对比度要求；这不改变清透薄荷的整体视觉方向。

- [ ] **步骤 2：同步外观页的浅色主题预览色**

把 `styles.css` 根级预览变量改成与原型一致的值，使“外观”页在深色主题下预览浅色主题时也能准确展示：

```css
--preview-light-sidebar: #f2faf7;
--preview-light-content: #ffffff;
--preview-light-panel: #f7fcfa;
--preview-shadow: rgb(23 51 47 / 10%);
```

不修改 `--preview-dark-sidebar`、`--preview-dark-content` 和 `--preview-dark-panel` 的深色预览语义。

- [ ] **步骤 3：为浅色面板和当前实例增加作用域覆盖**

在通用 `.panel`、`.proxy-instance-sidebar-card` 规则之后加入以下 CSS。通用规则和深色主题的阴影保持不变；浅色面板改为更轻的阴影，实例选中态使用悬停边框色，导航激活线继续使用 `--border-selected` 的主强调色：

```css
.app-shell[data-theme="light"] .panel,
.app-shell[data-theme="light"] .json-preview-card,
.app-shell[data-theme="light"] .json-preview-input-shell {
  box-shadow: 0 10px 26px var(--shadow-color);
}

.app-shell[data-theme="light"] .proxy-instance-sidebar-card:hover,
.app-shell[data-theme="light"] .proxy-instance-sidebar-card.selected {
  border-color: var(--border-hover);
}
```

不要修改 `.sidebar`、`.content`、`.panel`、`.metric-grid` 和 `.button-row` 的布局属性；它们会通过现有变量自动获得新的画布、卡片、指标块和按钮层级。

- [ ] **步骤 4：运行主题测试确认通过**

运行：

```bash
npx tsx --test test/renderer/theme.test.ts
```

预期：主题解析、浅色/深色 token、焦点对比度、导航状态、外观页响应式契约全部 PASS。若焦点或文字 AA 测试失败，优先加深对应浅色文字/焦点 token；不要降低测试阈值，也不要改动深色 token。

- [ ] **步骤 5：提交 CSS 实现**

```bash
git add src/renderer/styles.css
git commit -m "style: refresh light theme palette"
```

## 任务 3：完成构建、回归和视觉验收

**文件：**

- 读取：`src/renderer/styles.css`、`src/renderer/components/AppearancePage.tsx`、`src/renderer/App.tsx`。
- 验证：不新增文件，不暂存当前 worktree 的其他改动。

- [ ] **步骤 1：运行 renderer 主题与中文界面回归测试**

运行：

```bash
npx tsx --test test/renderer/theme.test.ts test/renderer/chinese-ui.test.ts
```

预期：全部 PASS，且测试没有报告深色主题 token 被浅色主题覆盖。

- [ ] **步骤 2：运行完整构建**

运行：

```bash
npm run build
```

预期：Electron 主进程 TypeScript、renderer TypeScript 和 Vite 构建全部成功，无 CSS 解析错误。

- [ ] **步骤 3：运行完整测试套件**

运行：

```bash
npm test
```

预期：构建和全部 `node:test` 测试通过。已有与本次无关的失败必须原样记录，不得通过修改业务代码或跳过测试来消除。

- [ ] **步骤 4：手动检查浅色主题的关键页面和主题切换**

运行：

```bash
npm run dev
```

在应用中完成以下检查：

1. 打开“外观”，选择“浅色”，确认预览中的侧栏为极浅薄荷色、内容为白色。
2. 回到“概览”，确认主画布接近白色，侧栏与内容有轻微分区，面板/指标块/日志仍能区分。
3. 检查当前代理实例、当前导航、运行中标签、主按钮和次要按钮：绿色强调清晰，但没有大面积绿色填充。
4. 打开“请求”“加密”“JSON 可视化”“日志”和“外观”，确认没有横向溢出、布局跳动或输入框变成灰块。
5. 切换“深色”，确认深色外观与本次改动前一致；再切回“浅色”，确认主题切换立即生效。

- [ ] **步骤 5：检查差异范围和最终工作树**

运行：

```bash
git diff --check HEAD~2..HEAD
git diff --name-only HEAD~2..HEAD
git status --short
```

预期：本次两个提交只包含 `test/renderer/theme.test.ts`、`src/renderer/styles.css`；`git status --short` 中工作区其余已有改动保持原状态，没有被暂存、覆盖或删除。
