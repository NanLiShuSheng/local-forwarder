# 加密剩余时间显示实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（- [ ]）语法来跟踪进度。

**目标：** 在加密进度卡中显示基于文件处理速度的预计剩余时间。

**架构：** 复用 EncryptionProgress.current、total 和 phase，在 ConfigPages 内记录处理阶段起始时间并每秒刷新展示。加密器和 IPC 保持不变；估算口径与进度条一致，使用 current 包含增量模式下跳过的文件。

**技术栈：** React、TypeScript、现有 Electron 加密进度事件、CSS。

---

## 文件结构

- 修改：src/renderer/components/ConfigPages.tsx — 保存进度阶段和处理开始时间，计算和格式化剩余时间，并更新进度回调。
- 修改：src/renderer/styles.css — 允许增加 ETA 后的统计行在窄窗口内换行。
- 不修改测试文件：当前任务约束未授权新增或运行测试；使用 npm run build 验证编译。

## 任务 1：在加密进度卡显示 ETA

**文件：**
- 修改：src/renderer/components/ConfigPages.tsx
- 修改：src/renderer/styles.css

- [ ] **步骤 1：扩充进度状态并实现估算格式化**

把进度状态扩展为包含 idle、scanning、processing、completed 阶段；在 processing 首次到达时记录 Date.now()。仅当正在处理且 current > 0、total > current 时计算：

    elapsedSeconds = max(0, (now - startedAt) / 1000)
    remainingSeconds = ceil(elapsedSeconds * (total - current) / current)

扫描中或 current 为 0 时显示“计算中”；阶段为 completed 时显示“已完成”；任务空闲或失败后显示“—”。剩余秒数小于 60 时显示秒数；不足一小时则向上取整显示分钟；一小时及以上显示小时和剩余分钟。

- [ ] **步骤 2：更新进度事件和卡片统计行**

进度回调同步保存 phase、current 和 total。运行期间每秒更新当前时间，清理卸载或任务停止后的 interval。点击开始时清除上次起始时间并设为扫描阶段；成功后设置 completed。在现有统计行追加“预计剩余时间：{etaText}”，不改变进度条的 current / total 计算。

- [ ] **步骤 3：让统计行适配较窄窗口**

在 .encryption-progress-meta 规则增加 flex-wrap: wrap，保留现有布局、颜色和间距。

- [ ] **步骤 4：构建检查**

运行 npm run build。预期 TypeScript 检查和 Vite renderer 构建成功；不运行测试命令。
