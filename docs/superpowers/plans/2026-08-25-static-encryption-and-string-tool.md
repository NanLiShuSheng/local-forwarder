# 静态加密与字符串工具行为调整实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让目录加密正常处理 `dist`，并让字符串工具在服务运行时仍能完成静态处理且保留结果。

**架构：** 加密只调整核心扫描器的目录排除集合和页面说明，不改变输出安全边界。字符串工具继续使用共享纯函数计算结果，但将执行流程改为先更新本地结果、再尝试保存草稿；保存失败只提示持久化失败，不影响静态结果。

**技术栈：** TypeScript、Node `node:test`、React、Electron renderer contract tests。

---

## 文件清单

- 修改：`src/core/encryption/encryptor.ts`：移除 `dist` 目录过滤。
- 修改：`src/renderer/components/ConfigPages.tsx`：更新加密页面说明，准确描述扫描规则。
- 修改：`src/renderer/components/StringToolPage.tsx`：静态处理先完成，持久化失败不覆盖结果。
- 修改：`test/core/encryption/encryptor.test.ts`：更新 `dist` 预期并确认仍过滤其他排除项。
- 修改：`test/renderer/string-tool.test.ts`：增加字符串工具保存失败时保留静态结果的回归检查。

### 任务 1：加密扫描包含 dist

**文件：**
- 修改：`test/core/encryption/encryptor.test.ts`
- 修改：`src/core/encryption/encryptor.ts`
- 修改：`src/renderer/components/ConfigPages.tsx`

- [ ] **步骤 1：先修改测试，表达新的扫描行为**

在 `makeFixture` 已存在的 `dist/bundle.js` 基础上，将 `collectFiles` 的预期从 `app.js`、`nested/page.html` 改为同时包含 `dist/bundle.js`；将加密结果的总数从 `2` 改为 `3`，并断言 `outputDir/dist/bundle.js.d` 内容与源文件相同。保留对隐藏项、`node_modules` 和 `.map` 的排除断言。

- [ ] **步骤 2：运行加密测试确认当前实现失败**

运行：

```bash
npx tsx --test test/core/encryption/encryptor.test.ts
```

预期：失败原因是当前结果缺少 `dist/bundle.js` 且总数仍为 `2`。

- [ ] **步骤 3：实现最小修改**

在 `src/core/encryption/encryptor.ts` 将：

```ts
const excludedDirectoryNames = new Set(["node_modules", "dist"]);
```

改为：

```ts
const excludedDirectoryNames = new Set(["node_modules"]);
```

在加密页面说明中删除 `dist`，保留“隐藏项、node_modules 和 .map 文件”的准确描述。

- [ ] **步骤 4：运行加密测试确认通过**

运行同一命令，预期所有加密测试通过，且临时目录清理与路径安全测试保持通过。

- [ ] **步骤 5：提交独立变更**

```bash
git add src/core/encryption/encryptor.ts src/renderer/components/ConfigPages.tsx test/core/encryption/encryptor.test.ts
git commit -m "fix: encrypt files under dist directories"
```

### 任务 2：字符串工具静态处理不依赖服务状态

**文件：**
- 修改：`src/renderer/components/StringToolPage.tsx`
- 修改：`test/renderer/string-tool.test.ts`

- [ ] **步骤 1：先增加保存失败仍保留结果的行为测试**

在 renderer contract 测试中读取 `StringToolPage.tsx`，断言执行函数包含先设置 `outputText` 再调用保存的顺序，并断言保存失败文案明确为“结果已生成，但配置未保存”。同时断言源码不存在“请先停止服务”这一字符串工具专用提示。

- [ ] **步骤 2：运行字符串工具测试确认当前实现失败**

运行：

```bash
npx tsx --test test/renderer/string-tool.test.ts
```

预期：新增断言失败，因为当前保存失败提示是“配置未保存，请先停止服务”，且执行流程没有区分静态结果与持久化结果。

- [ ] **步骤 3：实现最小静态处理流程**

将 `saveDraft` 的失败提示改为“结果已生成，但配置未保存”。在 `execute` 中保留以下顺序：先调用 `applyStringOperation`，构造带有 `outputText` 的 `next`，调用 `setDraft(next)`，再调用 `saveDraft(next)`。保存返回 `false` 时不得清空或回滚 `draft.outputText`；成功时清除错误。`clear` 仍可保存清空后的草稿，但保存失败只显示同样的持久化提示。

- [ ] **步骤 4：运行字符串工具测试确认通过**

运行同一命令，预期全部 renderer 字符串工具测试通过。

- [ ] **步骤 5：提交独立变更**

```bash
git add src/renderer/components/StringToolPage.tsx test/renderer/string-tool.test.ts
git commit -m "fix: keep string tool processing independent of runtime"
```

### 任务 3：完整验证与安装

**文件：**
- 不新增业务源码；验证任务 1、2 的变更。

- [ ] **步骤 1：运行全量测试**

```bash
npm test
```

预期：构建成功，所有 Node 测试通过，退出码为 `0`。

- [ ] **步骤 2：检查差异格式**

```bash
git diff --check HEAD~2..HEAD
```

预期：无输出、退出码为 `0`。

- [ ] **步骤 3：生成并校验 Intel x64 安装包**

```bash
npm run package:x64
```

预期：生成 `release/Local Forwarder-0.1.0.dmg`，并完成项目内置的 DMG 校验。

- [ ] **步骤 4：安装应用**

将 DMG 挂载后把 `Local Forwarder.app` 复制到 `/Applications/Local Forwarder.app`；若目标应用已存在，先将旧应用移入 macOS 废纸篓，再复制新版本。安装后确认 `/Applications/Local Forwarder.app` 存在。

- [ ] **步骤 5：记录安装验证结果**

运行：

```bash
test -d "/Applications/Local Forwarder.app"
```

预期：退出码 `0`。如果当前环境无法启动 Electron GUI，只报告安装复制成功及 GUI smoke 的实际错误，不将其假报为通过。
