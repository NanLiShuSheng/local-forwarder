import { useEffect, useMemo, useRef, useState } from "react";
import { flattenJsonValue, jsonPreviewType, parseJsonPreviewText, type JsonPreviewRow, type JsonPreviewValue } from "../../shared/json-preview";

type JsonPreviewView = "tree" | "table" | "raw";

const defaultJsonText = `{
  "duration": "7ms",
  "note": "查询成功",
  "code": 1,
  "records": [
    {
      "qqfylx": "",
      "cblx": "3",
      "xyhtfylx": "",
      "khkzxz": "",
      "zhlb": "1",
      "khlb": "0",
      "zzjzh": "100997415",
      "khh": "5937371",
      "khfz": "110",
      "zhzt": "0",
      "khfl": "1",
      "wtfs": "1;4;6;53;80;96",
      "zjzh": "100997415",
      "khrq": "20260803",
      "zhmc": "重置密码",
      "fylxc": "999988379999898299999999553699999999999999999999999999999999980088812999999999999"
    }
  ],
  "count": 1,
  "upstreamCode": "1",
  "upstreamNote": "查询成功",
  "upstreamDuration": "5ms",
  "clzt": 8,
  "timeout": false
}`;
const defaultParseResult = parseJsonPreviewText(defaultJsonText);

function isContainer(value: JsonPreviewValue): value is JsonPreviewValue[] | { [key: string]: JsonPreviewValue } {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function childEntries(value: JsonPreviewValue): Array<{ key: string; path: string; value: JsonPreviewValue }> {
  if (Array.isArray(value)) return value.map((child, index) => ({ key: `[${index}]`, path: `[${index}]`, value: child }));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).map(([key, child]) => ({ key, path: /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`, value: child }));
  }
  return [];
}

function valueText(value: JsonPreviewValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.length} 项]`;
  if (typeof value === "object") return `{${Object.keys(value).length} 个字段}`;
  return String(value);
}

function valueClass(value: JsonPreviewValue): string {
  return jsonPreviewType(value);
}

function displayValue(value: JsonPreviewValue, maxLength = 160): string {
  const text = typeof value === "string" ? value : valueText(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function defaultExpandedPaths(value: JsonPreviewValue): Set<string> {
  const paths = new Set<string>(["$"]);
  const rows = flattenJsonValue(value);
  rows.filter((row) => row.type === "object" || row.type === "array").forEach((row) => paths.add(row.path));
  return paths;
}

export function createJsonPrefillGuard() {
  let lastPrefillText: string | undefined;
  let hasApplied = false;
  return (prefillText: string | undefined, updateInput: (text: string) => void, onPrefillApplied?: () => void) => {
    if (prefillText === undefined) {
      lastPrefillText = undefined;
      hasApplied = false;
      return;
    }
    if (hasApplied && lastPrefillText === prefillText) return;
    updateInput(prefillText);
    lastPrefillText = prefillText;
    hasApplied = true;
    onPrefillApplied?.();
  };
}

function matchesSearch(key: string, path: string, value: JsonPreviewValue, search: string): boolean {
  if (search === "") return true;
  const needle = search.toLocaleLowerCase();
  return `${key} ${path} ${valueText(value)}`.toLocaleLowerCase().includes(needle);
}

function containsSearch(value: JsonPreviewValue, path: string, key: string, search: string): boolean {
  if (matchesSearch(key, path, value, search)) return true;
  return childEntries(value).some((child) => containsSearch(child.value, `${path}${child.path}`, child.key, search));
}

function visibleTableRows(rows: JsonPreviewRow[], expandedPaths: Set<string>, search: string): JsonPreviewRow[] {
  const visible: JsonPreviewRow[] = [];
  const ancestors: Array<{ expanded: boolean }> = [];
  for (const row of rows) {
    while (ancestors.length > row.depth) ancestors.pop();
    const expandable = row.type === "object" || row.type === "array";
    const hiddenByAncestor = ancestors.some((ancestor) => !ancestor.expanded);
    if (!hiddenByAncestor && (search === "" || containsSearch(row.value, row.path, row.key, search))) visible.push(row);
    if (expandable) ancestors.push({ expanded: expandedPaths.has(row.path) || search !== "" });
  }
  return visible;
}

function ValueLabel({ value }: { value: JsonPreviewValue }) {
  const fullText = typeof value === "string" ? JSON.stringify(value) : valueText(value);
  return <span className={`json-preview-value json-preview-value-${valueClass(value)}`} title={fullText}>{displayValue(value)}</span>;
}

interface TreeNodeProps {
  keyLabel: string;
  path: string;
  value: JsonPreviewValue;
  depth: number;
  expandedPaths: Set<string>;
  search: string;
  selectedPath: string;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}

function TreeNode({ keyLabel, path, value, depth, expandedPaths, search, selectedPath, onSelect, onToggle }: TreeNodeProps) {
  if (!containsSearch(value, path, keyLabel, search)) return null;
  const container = isContainer(value);
  const expanded = expandedPaths.has(path) || search !== "";
  const entries = container ? childEntries(value) : [];
  return <>
    <div className={`json-preview-tree-row ${selectedPath === path ? "selected" : ""}`} style={{ paddingLeft: `${depth * 18 + 8}px` }} onClick={() => onSelect(path)}>
      {container ? <button className="json-preview-tree-toggle" type="button" aria-label={expanded ? "收起节点" : "展开节点"} onClick={(event) => { event.stopPropagation(); onToggle(path); }}>{expanded ? "⌄" : "›"}</button> : <span className="json-preview-tree-toggle empty">·</span>}
      <span className="json-preview-tree-key">{keyLabel}</span><span className="json-preview-tree-colon">: </span><ValueLabel value={value} />
      {container && <span className="json-preview-count">{Array.isArray(value) ? `${value.length} 项` : `${Object.keys(value).length} 字段`}</span>}
    </div>
    {container && expanded && entries.map((child) => <TreeNode key={child.path} keyLabel={child.key} path={`${path}${child.path}`} value={child.value} depth={depth + 1} expandedPaths={expandedPaths} search={search} selectedPath={selectedPath} onSelect={onSelect} onToggle={onToggle} />)}
  </>;
}

function typeLabel(type: JsonPreviewRow["type"]): string {
  return type === "object" ? "对象" : type === "array" ? "数组" : type === "string" ? "字符串" : type === "number" ? "数字" : type === "boolean" ? "布尔值" : "空值";
}

function jsonStats(value: JsonPreviewValue, rows: JsonPreviewRow[]) {
  return {
    rootType: jsonPreviewType(value),
    fields: rows.length,
    arrays: rows.filter((row) => row.type === "array").length,
  };
}

interface JsonPreviewCanvasColors {
  background: string;
  codeBackground: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  subtleBorder: string;
  bright: string;
  text: string;
  muted: string;
  info: string;
  success: string;
  warning: string;
  danger: string;
  selection: string;
}

interface JsonPreviewCanvasOptions {
  preview: HTMLElement;
  activeView: JsonPreviewView;
  value: JsonPreviewValue;
  formatted: string;
  visibleRows: JsonPreviewRow[];
  selectedPath: string;
  search: string;
  stats: ReturnType<typeof jsonStats>;
}

interface JsonPreviewCanvasResult {
  canvas: HTMLCanvasElement;
  scaled: boolean;
}

const exportSansFont = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const exportBoldFont = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const exportMonoFont = '13px ui-monospace, SFMono-Regular, Menlo, monospace';
const exportSmallFont = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const exportLineHeight = 20;
const exportMaxCanvasEdge = 16000;

function cssToken(style: CSSStyleDeclaration, name: string, fallback: string): string {
  return style.getPropertyValue(name).trim() || fallback;
}

function exportColors(preview: HTMLElement): JsonPreviewCanvasColors {
  const style = getComputedStyle(preview);
  return {
    background: cssToken(style, "--panel-background", style.backgroundColor || "#ffffff"),
    codeBackground: cssToken(style, "--code-background", "#f4f7fb"),
    surface: cssToken(style, "--surface-background", "#f8fafc"),
    surfaceAlt: cssToken(style, "--surface-alt-background", "#f0f4f8"),
    border: cssToken(style, "--border-default", "#d6dfeb"),
    subtleBorder: cssToken(style, "--border-subtle", "#dbe3ed"),
    bright: cssToken(style, "--text-bright", "#152033"),
    text: cssToken(style, "--text-secondary", "#4e6078"),
    muted: cssToken(style, "--text-muted", "#52647b"),
    info: cssToken(style, "--info", "#256da8"),
    success: cssToken(style, "--text-success", "#086b53"),
    warning: cssToken(style, "--warning", "#8a5a00"),
    danger: cssToken(style, "--danger-text", "#a93545"),
    selection: cssToken(style, "--selection-background", "#d7eee7"),
  };
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  return text.split(/\r?\n/).flatMap((segment) => {
    if (segment === "") return [""];
    const lines: string[] = [];
    let line = "";
    for (const character of Array.from(segment)) {
      const next = `${line}${character}`;
      if (line !== "" && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    lines.push(line);
    return lines;
  });
}

function canvasValueColor(type: JsonPreviewRow["type"], colors: JsonPreviewCanvasColors): string {
  if (type === "string") return colors.success;
  if (type === "number") return colors.warning;
  if (type === "boolean") return colors.danger;
  if (type === "object" || type === "array") return colors.text;
  return colors.muted;
}

function drawCanvasText(context: CanvasRenderingContext2D, lines: string[], x: number, top: number, color: string, font: string): void {
  context.font = font;
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x, top + index * exportLineHeight));
}

function createJsonPreviewCanvas(options: JsonPreviewCanvasOptions): JsonPreviewCanvasResult {
  const { preview, activeView, value, formatted, visibleRows, selectedPath, search, stats } = options;
  const colors = exportColors(preview);
  const width = Math.max(720, Math.min(1600, Math.ceil(preview.getBoundingClientRect().width || preview.clientWidth || 1200)));
  const padding = 24;
  const contentWidth = width - padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = 1;
  const measureContext = canvas.getContext("2d");
  if (measureContext === null) throw new Error("无法创建图片画布");

  const tableColumnWidths = [contentWidth * 0.38, contentWidth * 0.47, contentWidth * 0.15];
  const tableLayouts = visibleRows.map((row) => {
    measureContext.font = exportMonoFont;
    const pathLines = wrapCanvasText(measureContext, row.path, tableColumnWidths[0] - 12);
    measureContext.font = exportSansFont;
    const valueLines = wrapCanvasText(measureContext, displayValue(row.value), tableColumnWidths[1] - 12);
    measureContext.font = exportSmallFont;
    const typeLines = wrapCanvasText(measureContext, typeLabel(row.type), tableColumnWidths[2] - 12);
    return { row, pathLines, valueLines, typeLines, height: Math.max(pathLines.length, valueLines.length, typeLines.length) * exportLineHeight + 12 };
  });
  measureContext.font = exportMonoFont;
  const rawLines = formatted.split(/\r?\n/).flatMap((line) => wrapCanvasText(measureContext, line, contentWidth - 20));
  const treeLayouts = visibleRows.map((row) => {
    const indent = row.depth * 18 + 10;
    measureContext.font = exportMonoFont;
    const labelLines = wrapCanvasText(measureContext, `${row.key}: ${displayValue(row.value)}`, contentWidth - indent - 10);
    return { row, labelLines, height: Math.max(1, labelLines.length) * exportLineHeight + 8 };
  });

  const headerHeight = 62;
  const tabsHeight = 38;
  const summaryHeight = 64;
  const toolbarHeight = activeView === "raw" ? 0 : 40;
  const dataTop = padding + headerHeight + tabsHeight + summaryHeight + toolbarHeight + 22;
  const dataHeight = activeView === "raw"
    ? Math.max(120, rawLines.length * exportLineHeight + 20)
    : activeView === "table"
      ? Math.max(120, 34 + tableLayouts.reduce((total, layout) => total + layout.height, 0))
      : Math.max(120, treeLayouts.reduce((total, layout) => total + layout.height, 0) + 12);
  const totalHeight = dataTop + dataHeight + 48;
  const scale = Math.min(1, exportMaxCanvasEdge / width, exportMaxCanvasEdge / totalHeight);
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(totalHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("无法创建图片画布");
  context.scale(scale, scale);
  context.textBaseline = "top";
  context.fillStyle = colors.background;
  context.fillRect(0, 0, width, totalHeight);
  context.strokeStyle = colors.border;
  context.strokeRect(0.5, 0.5, width - 1, totalHeight - 1);

  context.font = exportBoldFont;
  context.fillStyle = colors.bright;
  context.fillText("数据预览", padding, padding);
  context.font = exportSmallFont;
  context.fillStyle = colors.success;
  context.fillText("● 有效 JSON", padding, padding + 26);

  const tabLabels: Array<[JsonPreviewView, string]> = [["tree", "树形视图"], ["table", "表格视图"], ["raw", "原始 JSON"]];
  tabLabels.forEach(([view, label], index) => {
    const x = padding + index * 92;
    if (view === activeView) {
      context.fillStyle = colors.surfaceAlt;
      context.fillRect(x, padding + headerHeight, 82, 28);
    }
    context.font = exportSmallFont;
    context.fillStyle = view === activeView ? colors.success : colors.muted;
    context.fillText(label, x + 10, padding + headerHeight + 7);
  });

  const summary = [["根节点", stats.rootType], ["字段数", String(stats.fields)], ["数组", String(stats.arrays)], ["解析状态", "<1ms"]];
  const summaryGap = 8;
  const summaryWidth = (contentWidth - summaryGap * (summary.length - 1)) / summary.length;
  const summaryTop = padding + headerHeight + tabsHeight;
  summary.forEach(([label, text], index) => {
    const x = padding + index * (summaryWidth + summaryGap);
    context.fillStyle = colors.surfaceAlt;
    context.fillRect(x, summaryTop, summaryWidth, summaryHeight);
    context.strokeStyle = colors.subtleBorder;
    context.strokeRect(x + 0.5, summaryTop + 0.5, summaryWidth - 1, summaryHeight - 1);
    context.font = exportSmallFont;
    context.fillStyle = colors.muted;
    context.fillText(label, x + 10, summaryTop + 10);
    context.font = `700 ${exportSmallFont.slice(0, -2)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillStyle = index === 3 ? colors.success : colors.bright;
    context.fillText(text, x + 10, summaryTop + 32);
  });

  if (activeView !== "raw") {
    const toolbarTop = summaryTop + summaryHeight + 12;
    context.strokeStyle = colors.border;
    context.strokeRect(padding + 0.5, toolbarTop + 0.5, 230, 28);
    context.font = exportSmallFont;
    context.fillStyle = colors.muted;
    context.fillText(search === "" ? "过滤字段或值" : `过滤：${search}`, padding + 10, toolbarTop + 7);
  }

  context.fillStyle = colors.codeBackground;
  context.fillRect(padding, dataTop, contentWidth, dataHeight);
  context.strokeStyle = colors.subtleBorder;
  context.strokeRect(padding + 0.5, dataTop + 0.5, contentWidth - 1, dataHeight - 1);

  if (activeView === "raw") {
    drawCanvasText(context, rawLines, padding + 10, dataTop + 12, colors.text, exportMonoFont);
  } else if (activeView === "table") {
    const headerLabels = ["字段路径", "值", "类型"];
    let x = padding;
    context.fillStyle = colors.surfaceAlt;
    context.fillRect(padding, dataTop, contentWidth, 34);
    headerLabels.forEach((label, index) => {
      context.font = exportSmallFont;
      context.fillStyle = colors.muted;
      context.fillText(label, x + 10, dataTop + 9);
      x += tableColumnWidths[index];
    });
    let rowTop = dataTop + 34;
    tableLayouts.forEach((layout) => {
      if (layout.row.path === selectedPath) {
        context.fillStyle = colors.selection;
        context.fillRect(padding, rowTop, contentWidth, layout.height);
      }
      drawCanvasText(context, layout.pathLines, padding + 10, rowTop + 6, colors.info, exportMonoFont);
      drawCanvasText(context, layout.valueLines, padding + tableColumnWidths[0] + 10, rowTop + 6, canvasValueColor(layout.row.type, colors), exportSansFont);
      drawCanvasText(context, layout.typeLines, padding + tableColumnWidths[0] + tableColumnWidths[1] + 10, rowTop + 6, colors.muted, exportSmallFont);
      context.strokeStyle = colors.subtleBorder;
      context.beginPath();
      context.moveTo(padding, rowTop + layout.height - 0.5);
      context.lineTo(padding + contentWidth, rowTop + layout.height - 0.5);
      context.stroke();
      rowTop += layout.height;
    });
  } else {
    let rowTop = dataTop + 8;
    treeLayouts.forEach((layout) => {
      const x = padding + layout.row.depth * 18 + 10;
      if (layout.row.path === selectedPath) {
        context.fillStyle = colors.selection;
        context.fillRect(padding, rowTop - 2, contentWidth, layout.height);
      }
      context.font = exportMonoFont;
      context.fillStyle = canvasValueColor(layout.row.type, colors);
      context.fillText(`${layout.row.type === "object" || layout.row.type === "array" ? "⌄" : "·"} `, x - 10, rowTop);
      drawCanvasText(context, layout.labelLines, x + 8, rowTop, canvasValueColor(layout.row.type, colors), exportMonoFont);
      rowTop += layout.height;
    });
  }

  context.font = exportSmallFont;
  context.fillStyle = colors.muted;
  context.fillText(activeView === "table" ? "ⓘ 点击对象或数组行可展开子字段" : "ⓘ 长字符串默认截断，数组和对象会显示节点数量", padding, dataTop + dataHeight + 18);
  return { canvas, scaled: scale < 1 };
}

export function JsonPreviewPage({ prefillText, onPrefillApplied }: { prefillText?: string; onPrefillApplied?: () => void } = {}) {
  const [inputText, setInputText] = useState(defaultJsonText);
  const [parseResult, setParseResult] = useState(() => defaultParseResult);
  const [activeView, setActiveView] = useState<JsonPreviewView>("tree");
  const [search, setSearch] = useState("");
  const [selectedPath, setSelectedPath] = useState("$");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => defaultParseResult.ok ? defaultExpandedPaths(defaultParseResult.value) : new Set(["$"]));
  const [tableExpandedPaths, setTableExpandedPaths] = useState<Set<string>>(() => new Set(["$"]));
  const [notice, setNotice] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const prefillGuardRef = useRef<ReturnType<typeof createJsonPrefillGuard> | null>(null);
  if (prefillGuardRef.current === null) prefillGuardRef.current = createJsonPrefillGuard();

  const rows = useMemo(() => parseResult.ok ? flattenJsonValue(parseResult.value) : [], [parseResult]);
  const stats = useMemo(() => parseResult.ok ? jsonStats(parseResult.value, rows) : undefined, [parseResult, rows]);
  const tableVisibleRows = useMemo(() => visibleTableRows(rows, tableExpandedPaths, search.toLocaleLowerCase()), [rows, tableExpandedPaths, search]);
  const parseError = parseResult.ok ? "" : parseResult.error;

  const updateInput = (value: string) => {
    setInputText(value);
    const next = parseJsonPreviewText(value);
    setParseResult(next);
    setSelectedPath("$");
    setExpandedPaths(next.ok ? defaultExpandedPaths(next.value) : new Set(["$"]));
    setTableExpandedPaths(new Set(["$"]));
  };

  useEffect(() => {
    prefillGuardRef.current?.(prefillText, updateInput, onPrefillApplied);
  }, [prefillText, onPrefillApplied]);

  const importFile = async (file: File | undefined) => {
    if (file === undefined) return;
    try {
      updateInput(await file.text());
      setNotice(`已导入：${file.name}`);
    } catch {
      setNotice("文件读取失败");
    }
    window.setTimeout(() => setNotice(""), 1800);
  };

  const togglePath = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleTablePath = (path: string) => {
    setTableExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(successMessage);
    } catch {
      setNotice("复制失败，请检查剪贴板权限");
    }
    window.setTimeout(() => setNotice(""), 1800);
  };

  const copyFormatted = () => {
    if (parseResult.ok) void copyText(parseResult.formatted, "格式化 JSON 已复制");
  };

  const formatInput = () => {
    if (parseResult.ok) setInputText(parseResult.formatted);
  };

  const clearInput = () => updateInput("");

  const copyCurrentPath = () => void copyText(selectedPath, `路径已复制：${selectedPath}`);

  const exportPreviewImage = async () => {
    const preview = previewRef.current;
    if (preview === null || !parseResult.ok || isExporting) return;
    setIsExporting(true);
    try {
      const rootRow: JsonPreviewRow = {
        path: "$",
        key: "$",
        value: parseResult.value,
        type: jsonPreviewType(parseResult.value),
        depth: 0,
      };
      const rootExpanded = expandedPaths.has("$") || search !== "";
      const visibleRows = activeView === "tree"
        ? [rootRow, ...(rootExpanded ? visibleTableRows(rows, expandedPaths, search.toLocaleLowerCase()) : [])]
        : activeView === "table" ? tableVisibleRows : [];
      const { canvas, scaled } = createJsonPreviewCanvas({
        preview,
        activeView,
        value: parseResult.value,
        formatted: parseResult.formatted,
        visibleRows,
        selectedPath,
        search,
        stats: stats ?? jsonStats(parseResult.value, rows),
      });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob === null || blob.type !== "image/png") throw new Error("图片格式无效");
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.download = `json-preview-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        link.href = objectUrl;
        link.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      setNotice(scaled ? "数据预览图片已导出（数据较长，已自动缩放）" : "数据预览图片已导出");
    } catch {
      setNotice("图片导出失败，请减少数据量后重试");
    } finally {
      setIsExporting(false);
      window.setTimeout(() => setNotice(""), 2200);
    }
  };

  const expandAll = () => {
    if (!parseResult.ok) return;
    const allPaths = defaultExpandedPaths(parseResult.value);
    setExpandedPaths(allPaths);
    setTableExpandedPaths(allPaths);
  };

  const collapseAll = () => {
    const rootPath = new Set(["$"]);
    setExpandedPaths(rootPath);
    setTableExpandedPaths(rootPath);
  };

  return <section className="json-preview-panel">
    <div className="json-preview-workspace">
      <section className={`json-preview-input-shell ${isEditorOpen ? "open" : ""}`}>
        <div className="json-preview-input-bar">
          <div className="json-preview-input-summary"><h3>输入 JSON</h3><div className={`json-preview-status ${parseResult.ok ? "valid" : "invalid"}`}><span className="status-dot" />{parseResult.ok ? "已解析" : "JSON 解析失败"}</div><span className="json-preview-input-meta">{inputText.length.toLocaleString("zh-CN")} 字符 · {isEditorOpen ? "正在编辑" : "当前内容已收起"}</span></div>
          <button className="secondary-button" type="button" onClick={() => setIsEditorOpen((current) => !current)}>{isEditorOpen ? "收起编辑器" : "重新编辑"}</button>
        </div>
        {isEditorOpen && <div className="json-preview-input-editor">
          <div className="json-preview-card-actions"><input ref={fileInputRef} className="json-preview-file-input" type="file" accept=".json,.txt,application/json,text/plain" aria-label="导入 JSON 文件" onChange={(event) => { void importFile(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /><button className="secondary-button" type="button" onClick={() => fileInputRef.current?.click()}>导入文件</button><button className="secondary-button" type="button" disabled={!parseResult.ok} onClick={formatInput}>格式化</button><button className="primary-button" type="button" disabled={!parseResult.ok} onClick={copyFormatted}>复制格式化 JSON</button><button className="secondary-button" type="button" onClick={clearInput}>清空</button></div>
          <textarea className="json-preview-input" aria-label="输入 JSON" value={inputText} onChange={(event) => updateInput(event.target.value)} spellCheck={false} />
          <div className="json-preview-input-footer"><span>支持粘贴带反斜杠的响应字符串</span><span>{inputText.length.toLocaleString("zh-CN")} 字符</span></div>
        </div>}
      </section>
      <section ref={previewRef} className="json-preview-card json-preview-output-card">
        <div className="json-preview-output-heading"><div className="json-preview-output-title"><h3>数据预览</h3>{parseResult.ok ? <span className="json-preview-valid-label">● 有效 JSON</span> : <span className="json-preview-error-label">● {parseError}</span>}</div><button className="secondary-button" type="button" data-json-preview-export-control="true" disabled={!parseResult.ok || isExporting} onClick={() => void exportPreviewImage()}>{isExporting ? "导出中…" : "导出图片"}</button></div>
        <div className="json-preview-tabs" role="tablist" aria-label="JSON 预览视图">
          {([["tree", "树形视图"], ["table", "表格视图"], ["raw", "原始 JSON"]] as const).map(([view, label]) => <button key={view} className={activeView === view ? "active" : ""} type="button" role="tab" aria-selected={activeView === view} onClick={() => setActiveView(view)}>{label}</button>)}
        </div>
        {parseResult.ok && stats ? <div className="json-preview-summary"><div><span>根节点</span><strong>{stats.rootType}</strong></div><div><span>字段数</span><strong>{stats.fields}</strong></div><div><span>数组</span><strong>{stats.arrays}</strong></div><div><span>解析状态</span><strong className="good">&lt;1ms</strong></div></div> : <div className="json-preview-error-box"><strong>无法展示数据</strong><span>{parseError}</span></div>}
        {parseResult.ok && activeView !== "raw" && <div className="json-preview-toolbar"><input aria-label="过滤字段或值" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="⌕ 过滤字段或值" /><div><button className="small-button" type="button" onClick={expandAll}>全部展开</button><button className="small-button" type="button" onClick={collapseAll}>全部收起</button><button className="small-button" type="button" onClick={copyCurrentPath}>复制当前路径</button></div></div>}
        {parseResult.ok && activeView === "tree" && <div className="json-preview-tree" role="tree"><TreeNode keyLabel="$" path="$" value={parseResult.value} depth={0} expandedPaths={expandedPaths} search={search} selectedPath={selectedPath} onSelect={setSelectedPath} onToggle={togglePath} /></div>}
        {parseResult.ok && activeView === "table" && <div className="json-preview-table-wrap"><table className="json-preview-table"><thead><tr><th>字段路径</th><th>值</th><th>类型</th></tr></thead><tbody>{tableVisibleRows.map((row) => { const expandable = row.type === "object" || row.type === "array"; const expanded = tableExpandedPaths.has(row.path) || search !== ""; return <tr key={row.path} className={selectedPath === row.path ? "selected" : ""} aria-expanded={expandable ? expanded : undefined} onClick={() => { setSelectedPath(row.path); if (expandable) toggleTablePath(row.path); }}><td><div className="json-preview-table-path" style={{ paddingLeft: `${row.depth * 18}px` }}>{expandable ? <button className="json-preview-table-toggle" type="button" aria-label={expanded ? "收起对象" : "展开对象"} onClick={(event) => { event.stopPropagation(); toggleTablePath(row.path); }}>{expanded ? "⌄" : "›"}</button> : <span className="json-preview-table-toggle empty">·</span>}<span>{row.path}</span></div></td><td title={typeof row.value === "string" ? row.value : undefined}>{displayValue(row.value)}</td><td>{typeLabel(row.type)}</td></tr>; })}</tbody></table></div>}
        {parseResult.ok && activeView === "raw" && <pre className="json-preview-raw">{parseResult.formatted}</pre>}
        {parseResult.ok && <p className="json-preview-tip"><span>ⓘ</span>{activeView === "table" ? "点击对象或数组行可展开子字段；点击字段可复制路径。" : "点击字段可复制路径；长字符串默认截断，悬停可查看完整值。数组和对象会显示节点数量。"}</p>}
      </section>
    </div>
    {notice && <div className="json-preview-notice" role="status">{notice}</div>}
  </section>;
}
