export type WorkspaceGroupKey = "run" | "data" | "build" | "tools" | "settings";

export type WorkspaceRoute =
  | "workbench"
  | "activity"
  | "debug"
  | "session"
  | "kv"
  | "files"
  | "variables"
  | "build"
  | "jobs"
  | "json"
  | "logs"
  | "string"
  | "appearance"
  | "update"
  | "advanced";

export type WorkspaceIconName =
  | "workbench"
  | "environment"
  | "activity"
  | "debug"
  | "history"
  | "session"
  | "kv"
  | "files"
  | "variables"
  | "package"
  | "jobs"
  | "json"
  | "string"
  | "appearance"
  | "update"
  | "advanced"
  | "database"
  | "tools"
  | "settings"
  | "moon"
  | "sun"
  | "search"
  | "check"
  | "play"
  | "stop"
  | "chevron-down"
  | "close"
  | "send"
  | "filter"
  | "trash"
  | "refresh"
  | "more"
  | "arrow-right";

export const workspaceIconPaths: Record<WorkspaceIconName, string[]> = {
  workbench: ["M5 4h6v6H5z", "M15 4h6v6h-6z", "M5 14h6v6H5z", "M15 14h6v6h-6z"],
  environment: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
  activity: ["M3 12h4l2-6 4 12 2-6h6"],
  debug: ["M5 19 19 5", "M9 5h10v10"],
  history: ["M12 4a8 8 0 1 1-8 8", "M12 7v5l3 2", "M4 5v7h7"],
  session: ["M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "m11 12 8-8", "M16 7l2 2", "M14 9l2 2"],
  kv: ["M9 4c-2 0-3 1-3 3v2c0 2-1 3-2 3 1 0 2 1 2 3v2c0 2 1 3 3 3", "M15 4c2 0 3 1 3 3v2c0 2 1 3 2 3-1 0-2 1-2 3v2c0 2-1 3-3 3"],
  files: ["M6 3h8l4 4v14H6z", "M14 3v5h5", "M9 12h6", "M9 16h6"],
  variables: ["M12 3v18", "M16 7.5c0-1.4-1.8-2.5-4-2.5s-4 1.1-4 2.5S9.8 10 12 10s4 1.1 4 2.5S14.2 15 12 15s-4-1.1-4-2.5"],
  package: ["m12 3 8 4.5v9L12 21 4 16.5v-9z", "m4 7.5 8 4.5 8-4.5", "M12 12v9"],
  jobs: ["M8 6h13", "M8 12h13", "M8 18h13", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  json: ["M9 4c-2 0-3 1-3 3v2c0 2-1 3-2 3 1 0 2 1 2 3v2c0 2 1 3 3 3", "M15 4c2 0 3 1 3 3v2c0 2 1 3 2 3-1 0-2 1-2 3v2c0 2-1 3-3 3"],
  string: ["M4 17 8 7l4 10", "M5.5 13h5", "M15 17V7", "M15 7h3a2.5 2.5 0 0 1 0 5h-3", "M15 12h3.5a2.5 2.5 0 0 1 0 5H15"],
  appearance: ["M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  update: ["M12 3v12", "m7 10 5 5 5-5", "M5 20h14"],
  advanced: ["M4 7h16", "M4 17h16", "M9 5v4", "M15 15v4"],
  database: ["M5 5.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5-7-1.1-7-2.5Z", "M5 5.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6", "M5 11.5v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6"],
  tools: ["M14.7 6.3a4 4 0 0 1-5.2 5.2L5 16l3 3 4.5-4.5a4 4 0 0 1 5.2-5.2l-2.3 2.3-1.6-1.6 2.3-2.3Z"],
  settings: ["M4 7h16", "M4 17h16", "M9 5v4", "M15 15v4"],
  moon: ["M20 15.2A8 8 0 0 1 8.8 4 8 8 0 1 0 20 15.2Z"],
  sun: ["M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z", "M12 2v2", "M12 20v2", "M4.9 4.9l1.4 1.4", "M17.7 17.7l1.4 1.4", "M2 12h2", "M20 12h2", "M4.9 19.1l1.4-1.4", "M17.7 6.3l1.4-1.4"],
  search: ["M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z", "m16.5 16.5 4 4"],
  check: ["m5 12 4 4L19 6"],
  play: ["m8 5 11 7-11 7z"],
  stop: ["M7 7h10v10H7z"],
  "chevron-down": ["m7 10 5 5 5-5"],
  close: ["m6 6 12 12", "m18 6-12 12"],
  send: ["m4 12 16-8-5 16-4-6z", "M11 14 20 4"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13", "M10 11v5", "M14 11v5"],
  refresh: ["M20 7v5h-5", "M4 17v-5h5", "M6.1 8.5A7 7 0 0 1 19 12", "M17.9 15.5A7 7 0 0 1 5 12"],
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
  "arrow-right": ["M5 12h14", "m14 7 5 5-5 5"],
};

export interface WorkspaceNavItem {
  route: WorkspaceRoute;
  label: string;
  icon: WorkspaceIconName;
  description?: string;
}

export interface WorkspaceGroup {
  key: WorkspaceGroupKey;
  label: string;
  title: string;
  subtitle: string;
  eyebrow: string;
  section: string;
  icon: WorkspaceIconName;
  items: WorkspaceNavItem[];
  noteTitle: string;
  note: string;
}

export const workspaceGroups: Record<WorkspaceGroupKey, WorkspaceGroup> = {
  run: {
    key: "run",
    label: "运行",
    title: "运行",
    subtitle: "环境、请求与实时活动",
    eyebrow: "Runtime",
    section: "工作区",
    icon: "workbench",
    items: [
      { route: "workbench", label: "工作台", icon: "workbench" },
      { route: "debug", label: "请求调试", icon: "debug" },
      { route: "activity", label: "活动", icon: "activity" },
    ],
    noteTitle: "当前环境",
    note: "当前环境的监听地址、请求量和最近事件会同步刷新。",
  },
  data: {
    key: "data",
    label: "数据",
    title: "数据",
    subtitle: "当前环境与工作区数据",
    eyebrow: "Data",
    section: "浏览",
    icon: "database",
    items: [
      { route: "session", label: "登录缓存", icon: "session" },
      { route: "kv", label: "本地缓存", icon: "kv" },
      { route: "files", label: "文件缓存", icon: "files" },
      { route: "variables", label: "本地变量", icon: "variables" },
    ],
    noteTitle: "作用域",
    note: "登录缓存、本地缓存和文件缓存属于当前环境；本地变量全局共享。",
  },
  build: {
    key: "build",
    label: "构建",
    title: "构建",
    subtitle: "加密、解密与任务",
    eyebrow: "Build",
    section: "资源",
    icon: "package",
    items: [
      { route: "build", label: "资源构建", icon: "package" },
      { route: "jobs", label: "任务记录", icon: "jobs" },
    ],
    noteTitle: "全局任务",
    note: "构建期间可以切换环境或继续调试，进度会实时保留。",
  },
  tools: {
    key: "tools",
    label: "工具",
    title: "工具",
    subtitle: "轻量处理、格式转换与日志",
    eyebrow: "Tools",
    section: "工具",
    icon: "tools",
    items: [
      { route: "logs", label: "日志", icon: "activity" },
      { route: "json", label: "JSON 可视化", icon: "json" },
      { route: "string", label: "字符串处理", icon: "string" },
    ],
    noteTitle: "就地打开",
    note: "按 ⌘4 快速打开日志；应答和日志里的 JSON 可以直接进入工具页。",
  },
  settings: {
    key: "settings",
    label: "设置",
    title: "设置",
    subtitle: "偏好、更新与高级",
    eyebrow: "Settings",
    section: "应用",
    icon: "settings",
    items: [
      { route: "appearance", label: "外观", icon: "appearance" },
      { route: "update", label: "更新", icon: "update" },
      { route: "advanced", label: "高级", icon: "advanced" },
    ],
    noteTitle: "版本",
    note: "Local Forwarder 的偏好、更新和高级选项集中在这里。",
  },
};

export const workspaceRailGroups: WorkspaceGroupKey[] = ["run", "data", "build", "tools"];

export const workspaceRouteMeta: Record<WorkspaceRoute, { group: WorkspaceGroupKey }> = {
  workbench: { group: "run" },
  activity: { group: "run" },
  debug: { group: "run" },
  session: { group: "data" },
  kv: { group: "data" },
  files: { group: "data" },
  variables: { group: "data" },
  build: { group: "build" },
  jobs: { group: "build" },
  json: { group: "tools" },
  logs: { group: "tools" },
  string: { group: "tools" },
  appearance: { group: "settings" },
  update: { group: "settings" },
  advanced: { group: "settings" },
};

export const workspaceRouteLabels: Record<WorkspaceRoute, string> = Object.fromEntries(
  Object.values(workspaceGroups).flatMap((group) => group.items.map((item) => [item.route, item.label])),
) as Record<WorkspaceRoute, string>;
