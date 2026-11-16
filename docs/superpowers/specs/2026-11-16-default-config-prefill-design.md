# 新增代理实例默认数据填充设计

## 目标

新建代理实例（以及全新安装的默认实例）不再以空白配置起步：转发地址、请求目标和请求参数直接填入常用默认值，减少每次手工粘贴模板的成本。

## 行为

- `createDefaultConfig()` 生成的 `tcpTargets` 默认包含三条启用中的目标：
  - `hq` → `http://60.12.9.58:7778`（`protocol: http`、`transport: http`）
  - `jy` → `tcp://123.103.83.82:6064`（裸地址，TCP/TZT）
  - `zx` → `tcp://123.103.83.82:6064`（裸地址，TCP/TZT）
- 请求默认目标：`host = 123.103.83.82`，`port = 6064`。
- 请求参数默认填入以下模板（分号行仍为注释，发送时忽略）：
  `Action=100`、`account=600554432`、`password=600000`、`;password=123321`、`compassword=111111`、`MobileCode=17000000000`、`accounttype=zjaccount`、`;accounttype=khbh`、`MobileType=2`、`ReqlinkType=2`、`Cfrom=zxzq.iphone`、`TFrom=iphone`、`maxcount=1`。
- 转发地址输入框的 placeholder 由同一份默认目标推导（`60.12.9.58:7778`、`123.103.83.82:6064`、`123.103.83.82:6064`），清空输入框时仍然显示。
- 已保存的代理实例、用户自定义的地址与参数保持原样，不做迁移或覆盖。

## 实现范围

- 新增 `src/shared/config-defaults.ts`：集中定义默认转发目标工厂、默认请求 host/port 与参数模板。
- 修改 `src/core/config/model.ts`：`createDefaultConfig()` 使用上述默认值（影响新增实例、全新安装、旧版配置导入的基底）。
- 修改 `src/renderer/components/RequestPage.tsx`、`src/renderer/App.tsx`：渲染层兜底默认值与模型保持一致。
- 修改 `src/renderer/components/ConfigPages.tsx`：placeholder 由默认目标派生，避免两处维护。
- 新增 `test/core/config/config-defaults.test.ts`；更新 `test/core/config/legacy-parser.test.ts` 中继承默认 id/name 的断言。

## 测试与验收

- 新增默认值测试先失败后通过（默认目标、默认请求模板、每次调用返回独立对象）。
- legacy 导入时 `/reqxml` 目标继承 `hq`、`jy`、`zx` 名称，其余断言保持通过。
- 运行完整测试套件与构建，确认无回归。
- 通过隔离数据目录启动应用：点击"＋ 新增"后，概览页三个地址与请求页目标/参数均为默认值。

## 非目标

- 不修改已有实例已保存的地址、请求目标或参数。
- 不改变地址解析、历史记录、启用开关与保存逻辑。
- 不调整请求协议默认值（仍为 TZT TCP）。
