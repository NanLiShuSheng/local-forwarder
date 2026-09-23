# 紧凑概览布局实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将代理概览页调整为深色项目目录卡片、紧凑的三项可编辑配置，并移除概览中的 jy 上游地址与登录缓存展示。

**架构：** 保持现有 `ProxyInstancePanel` 的保存回调和字段状态，只调整 JSX 分组与 CSS，不新增 Tab 或数据接口。通过 renderer contract 测试锁定“概览不展示 jy/登录缓存”和紧凑布局类名。

**技术栈：** React、TypeScript、现有 renderer CSS、Node.js test runner。

---

### 任务 1：锁定概览展示约束

**文件：**
- 修改：`test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 1：编写失败的测试**
  - 要求 `ProxyInstancePanel.tsx` 不包含概览展示用的“登录缓存”、`loginCacheCount` 和“jy 上游地址”。
  - 要求组件包含项目目录卡片、紧凑字段容器和三个字段类名。

- [ ] **步骤 2：运行测试验证失败**
  - 运行：`node --import tsx --test test/renderer/proxy-instance-panel.test.ts`
  - 预期：现有概览仍包含登录缓存和 jy 上游地址，因此相关断言失败。

### 任务 2：实现紧凑概览布局

**文件：**
- 修改：`src/renderer/components/ProxyInstancePanel.tsx`
- 修改：`src/renderer/styles.css`

- [ ] **步骤 1：实现最少 JSX 变更**
  - 项目目录保留原输入、选择目录按钮和保存逻辑，增加深色卡片容器。
  - 三个编辑项分别显示监听主机、监听端口、超时时间，使用同一字段卡片结构。
  - 删除概览中的 jy 上游地址和登录缓存展示；左侧现有导航及概览下方转发地址配置保持不变。

- [ ] **步骤 2：实现紧凑主题样式**
  - 项目目录卡片使用现有深色面板色、边框和输入框颜色。
  - 三个字段等高三列排列，窄窗口时降为单列，底部操作区减少垂直间距。

### 任务 3：验证并打包安装

**文件：**
- 生成：`release/Local Forwarder-0.1.0.dmg`

- [ ] **步骤 1：运行 renderer 回归测试**
  - 运行：`node --import tsx --test test/renderer/proxy-instance-panel.test.ts`

- [ ] **步骤 2：运行完整打包校验**
  - 运行：`npm run package:x64`

- [ ] **步骤 3：安装并验证 `/Applications/Local Forwarder.app`**
  - 挂载 DMG、替换同名应用、卸载 DMG。
  - 核对版本、Bundle ID、`app.asar` 与协议资源，并启动应用确认进程存在。
