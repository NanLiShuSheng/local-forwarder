# GRID0 数组可视化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans（逐任务实现此计划）。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将管道分隔字符串数组在 JSON 树形预览中转换为可横向滚动、索引对齐的表格。

**架构：** 在 `src/shared/json-preview.ts` 增加纯函数解析特殊数组，返回字段名和补齐后的数据行。`JsonPreviewPage` 在树节点展开时调用该函数，特殊数组使用独立表格组件渲染；表格容器独立横向滚动，并固定首列。

**技术栈：** TypeScript、React、现有 JSON 预览组件、Node test、CSS。

---

### 任务 1：定义并测试管道分隔数组解析

**文件：**
- 修改：`src/shared/json-preview.ts`
- 测试：`test/shared/json-preview.test.ts`

- [x] **步骤 1：编写失败测试**：动态加载 `parsePipeDelimitedArray`，验证示例数组产生字段名、尾部空字段和补齐后的数据行；验证普通数组返回 `undefined`。
- [x] **步骤 2：运行测试确认失败**：运行 `node --import tsx --test test/shared/json-preview.test.ts`，预期因解析函数尚未导出而失败。
- [x] **步骤 3：实现最少解析代码**：新增 `PipeDelimitedArrayPreview` 类型和 `parsePipeDelimitedArray(value)`，仅接受全为含 `|` 字符串的非空数组，按最大列数补齐空字符串。
- [x] **步骤 4：运行测试确认通过**：重复运行同一命令，预期全部通过。

### 任务 2：接入树形 JSON 预览表格

**文件：**
- 修改：`src/renderer/components/JsonPreviewPage.tsx`
- 测试：`test/renderer/json-preview.test.ts`

- [x] **步骤 1：编写失败测试**：断言页面源码使用 `parsePipeDelimitedArray`、渲染特殊数组表格、显示“索引/字段名”，并保留普通 `TreeNode` 展开路径。
- [x] **步骤 2：运行测试确认失败**：运行 `node --import tsx --test test/renderer/json-preview.test.ts`，预期缺少特殊数组渲染标记而失败。
- [x] **步骤 3：实现最少渲染代码**：新增 `DelimitedArrayTable`，在数组树节点展开时优先渲染该表格；表头按列索引和字段名输出，数据行按补齐结果输出，空字符串渲染为空单元格。
- [x] **步骤 4：运行测试确认通过**：重复运行 JSON 预览测试，预期全部通过。

### 任务 3：实现独立横向滚动和首列固定

**文件：**
- 修改：`src/renderer/styles.css`
- 测试：`test/renderer/json-preview.test.ts`

- [x] **步骤 1：编写失败测试**：断言特殊数组表格容器设置 `overflow-x: auto`，表格有最小宽度，首列使用 `position: sticky` 和 `left: 0`。
- [x] **步骤 2：运行测试确认失败**：运行 JSON 预览测试，预期缺少样式规则而失败。
- [x] **步骤 3：实现最少 CSS**：限制表格容器最大宽度，设置横向滚动、最小列宽、首列固定和空单元格样式，并补充窄屏规则。
- [x] **步骤 4：运行测试确认通过**：重复运行 JSON 预览测试。

### 任务 4：全量验证

**文件：**
- 检查：`src/shared/json-preview.ts`、`src/renderer/components/JsonPreviewPage.tsx`、`src/renderer/styles.css`

- [x] **步骤 1：运行完整测试**：运行 `npm test`，构建成功且 311 项测试全部通过。
- [x] **步骤 2：检查差异格式**：运行 `git diff --check`，无输出错误。
