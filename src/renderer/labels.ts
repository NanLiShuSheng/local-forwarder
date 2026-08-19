import type { LogEntry, RuntimeStatus } from "../shared/contracts";

export const statusLabels: Record<RuntimeStatus["state"], string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "异常",
};

export const logLevelLabels: Record<LogEntry["level"], string> = {
  debug: "调试",
  info: "信息",
  warn: "警告",
  error: "错误",
};
