# 日志选中态优化设计

## 目标

修复日志列表选中行左侧强调条遮挡时间文字的问题，并按已确认的 v2 原型统一选中态展示：选中行只保留浅绿色背景，时间使用 24 小时制。

## 已确认的视觉规格

- 选中行保留现有浅绿色背景高亮。
- 移除选中行左侧强调条，不使用 `box-shadow`、`border-left` 或伪元素绘制选中标记。
- 日志行内容左侧增加少量内边距，时间文字与容器边缘保持约 8px 间距；所有行保持相同列对齐。
- 时间格式固定为 24 小时制，例如 `13:53:02`，不显示 `PM`。
- 保留当前选中行的 `selected` class 和 `aria-current` 无障碍语义，不改变点击选择、详情展示和筛选逻辑。

## 实现边界

- 修改 `src/renderer/components/LogPanel.tsx`：调用 `toLocaleTimeString` 时传入 `{ hour12: false }`。
- 修改 `src/renderer/styles.css`：将 `.log-row` 左侧 padding 调整为 8px，并移除 `.log-row.selected` 的左侧内阴影，仅保留背景和文字颜色。
- 修改 `test/renderer/log-panel.test.ts`：增加 24 小时制和选中态样式断言。
- 不修改日志数据结构、时间戳来源、排序、筛选和详情面板行为。

## 验收标准

1. 选中行的时间文字不被任何左侧装饰覆盖。
2. 选中行仍能通过浅绿色背景明确识别。
3. `LogPanel` 的时间渲染包含 `hour12: false`。
4. 相关 renderer 测试和生产构建通过。
