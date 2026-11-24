import { useEffect, useMemo, useRef, useState } from "react";
import type { ProxyInstanceSummary } from "../../shared/contracts";
import { decodeFileCacheValue, encodeFileCacheValue } from "../../shared/file-cache-value";
import { formatLocalCacheText, parseLocalCacheText } from "../../shared/local-cache";
import {
  describeLocalCacheEntry,
  filterLocalCacheEntries,
  formatLocalCacheCharCount,
  localCacheStats,
  localCacheTypeBadge,
  type LocalCacheEntry,
  type LocalCacheFilter,
} from "../local-cache-data";
import { localVariableLabel } from "../local-variable-data";
import type { WorkspaceRoute } from "../workspace-navigation";
import { WorkspaceIcon } from "./WorkspaceChrome";
import { useToast } from "./ToastProvider";

export type DataTab = "session" | "kv" | "files" | "variables";

interface DataBrowserPageProps {
  tab: DataTab;
  selectedInstance?: ProxyInstanceSummary;
  sessionValues: Record<string, string>;
  onSaveSession: (values: Record<string, string>) => Promise<boolean>;
  onNavigate: (route: WorkspaceRoute) => void;
}

type PageMode = "structured" | "text";

const tabs: Array<{ tab: DataTab; label: string; route: WorkspaceRoute }> = [
  { tab: "session", label: "登录缓存", route: "session" },
  { tab: "kv", label: "本地缓存", route: "kv" },
  { tab: "files", label: "文件缓存", route: "files" },
  { tab: "variables", label: "本地变量", route: "variables" },
];

const sourceCopy: Record<DataTab, string> = {
  session: "登录缓存",
  kv: "/reqsavemap",
  files: "/reqsavefile",
  variables: "工作区共享",
};

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) throw new Error("复制失败");
  } finally {
    textarea.remove();
  }
}

function displayValue(tab: DataTab, entry: LocalCacheEntry): string {
  if (tab !== "files") return entry.isJson ? entry.formatted : entry.value;
  return entry.isJson ? entry.formatted : decodeFileCacheValue(entry.value);
}

function DataTypeBadge({ entry }: { entry: LocalCacheEntry }) {
  const badge = localCacheTypeBadge(entry);
  if (entry.kind === "empty" || badge.className === "text") return null;
  return <span className={`lf-type-badge ${badge.className}`}>{badge.label}</span>;
}

function VariableLabelBadge({ label }: { label: string | undefined }) {
  return label === undefined ? null : <span className="lf-type-badge business" title="业务标签">{label}</span>;
}

export function DataBrowserPage({ tab, selectedInstance, sessionValues, onSaveSession, onNavigate }: DataBrowserPageProps) {
  const { notify, notifyError } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState<Record<DataTab, number>>({ session: Object.keys(sessionValues).length, kv: 0, files: 0, variables: 0 });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LocalCacheFilter>("all");
  const [pageMode, setPageMode] = useState<PageMode>("structured");
  const [selectedKey, setSelectedKey] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [text, setText] = useState("");
  const [dirtyText, setDirtyText] = useState(false);
  const valuesRef = useRef<Record<string, string>>({});
  const instanceId = selectedInstance?.id;
  const requestVersionRef = useRef(0);
  const importRef = useRef<HTMLInputElement>(null);

  const replaceValues = (next: Record<string, string>) => {
    valuesRef.current = { ...next };
    setValues({ ...next });
    setText(formatLocalCacheText(next));
  };

  useEffect(() => {
    setQuery("");
    setFilter("all");
    setSelectedKey(undefined);
    setEditing(false);
    setAdding(false);
    setDraft("");
    setNewKey("");
    setNewValue("");
    setDirtyText(false);
    setLoaded(false);
  }, [instanceId, tab]);

  useEffect(() => {
    if (tab !== "session") return;
    if (busy || editing || adding) return;
    replaceValues(sessionValues);
    setCounts((current) => ({ ...current, session: Object.keys(sessionValues).length }));
    setLoaded(true);
  }, [adding, busy, editing, sessionValues, tab]);

  useEffect(() => {
    const version = ++requestVersionRef.current;
    const load = async () => {
      try {
        if (tab === "session") return;
        const next = tab === "kv"
          ? await window.forwarder.getMapValues(instanceId)
          : tab === "files"
            ? await window.forwarder.getFileValues(instanceId)
            : await window.forwarder.getSharedValues();
        if (version !== requestVersionRef.current) return;
        replaceValues(next);
        setCounts((current) => ({ ...current, [tab]: Object.keys(next).length }));
        setLoaded(true);
      } catch (cause) {
        if (version === requestVersionRef.current) notifyError(cause, "数据读取失败");
      }
    };
    void load();
  }, [instanceId, notifyError, tab]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.forwarder.getMapValues(instanceId),
      window.forwarder.getFileValues(instanceId),
      window.forwarder.getSharedValues(),
    ]).then(([kv, files, variables]) => {
      if (!active) return;
      setCounts((current) => ({
        ...current,
        session: Object.keys(sessionValues).length,
        kv: Object.keys(kv).length,
        files: Object.keys(files).length,
        variables: Object.keys(variables).length,
      }));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [instanceId, sessionValues]);

  const entries = useMemo(
    () => filterLocalCacheEntries(values, query, filter, tab === "variables" ? localVariableLabel : undefined),
    [filter, query, tab, values],
  );
  const stats = useMemo(() => localCacheStats(values), [values]);
  const selectedEntry = selectedKey === undefined ? undefined : describeLocalCacheEntry(selectedKey, values[selectedKey] ?? "");

  useEffect(() => {
    if (adding || editing) return;
    if (entries.length === 0) {
      setSelectedKey(undefined);
      return;
    }
    if (selectedKey === undefined || !entries.some((entry) => entry.key === selectedKey)) setSelectedKey(entries[0]!.key);
  }, [adding, editing, entries, selectedKey]);

  const persist = async (next: Record<string, string>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    try {
      if (tab === "session") {
        if (!await onSaveSession(next)) return false;
      } else if (tab === "kv") {
        const result = await window.forwarder.saveMapValues(next, instanceId);
        if (!result.ok) throw new Error(result.error ?? "本地缓存保存失败");
      } else if (tab === "variables") {
        const result = await window.forwarder.saveSharedValues(next);
        if (!result.ok) throw new Error(result.error ?? "本地变量保存失败");
      } else {
        const removed = Object.keys(valuesRef.current).filter((key) => next[key] === undefined);
        for (const key of removed) {
          const result = await window.forwarder.deleteFileValue(key, instanceId);
          if (!result.ok) throw new Error(result.error ?? `文件 ${key} 删除失败`);
        }
        for (const [key, value] of Object.entries(next)) {
          if (valuesRef.current[key] === value) continue;
          const result = await window.forwarder.saveFileValue(key, encodeFileCacheValue(value), instanceId);
          if (!result.ok) throw new Error(result.error ?? `文件 ${key} 保存失败`);
        }
      }
      replaceValues(next);
      setCounts((current) => ({ ...current, [tab]: Object.keys(next).length }));
      setLoaded(true);
      return true;
    } catch (cause) {
      notifyError(cause, "数据保存失败");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const startAdd = () => {
    if (pageMode !== "structured") setPageMode("structured");
    setEditing(false);
    setAdding(true);
    setNewKey("");
    setNewValue("");
    setQuery("");
    setFilter("all");
  };

  const saveNew = async () => {
    const key = newKey.trim().toUpperCase();
    if (key === "") return notifyError("键名不能为空", "无法新增数据");
    if (valuesRef.current[key] !== undefined) return notifyError(`键“${key}”已存在`, "无法新增数据");
    if (await persist({ ...valuesRef.current, [key]: newValue })) {
      setSelectedKey(key);
      setAdding(false);
      setNewKey("");
      setNewValue("");
      notify({ kind: "success", message: `已新增 ${key}` });
    }
  };

  const saveEditing = async (): Promise<boolean> => {
    if (selectedEntry === undefined) return false;
    if (await persist({ ...valuesRef.current, [selectedEntry.key]: draft })) {
      setEditing(false);
      notify({ kind: "success", message: `${selectedEntry.key} 已保存` });
      return true;
    }
    return false;
  };

  const deleteSelected = async () => {
    if (selectedEntry === undefined || !window.confirm(`确定删除“${selectedEntry.key}”吗？`)) return;
    const next = { ...valuesRef.current };
    delete next[selectedEntry.key];
    if (await persist(next)) notify({ kind: "success", message: `${selectedEntry.key} 已删除` });
  };

  const clearAll = async () => {
    if (!window.confirm("确定清空当前数据分类吗？此操作不可撤销。")) return;
    if (tab === "files") {
      setBusy(true);
      try {
        const result = await window.forwarder.clearFileValues(instanceId);
        if (!result.ok) throw new Error(result.error ?? "文件缓存清空失败");
        replaceValues({});
      } catch (cause) {
        notifyError(cause, "数据清空失败");
        return;
      } finally {
        setBusy(false);
      }
    } else if (!await persist({})) {
      return;
    }
    try {
      setCounts((current) => ({ ...current, [tab]: 0 }));
      setSelectedKey(undefined);
      notify({ kind: "success", message: "数据已清空" });
    } catch (cause) {
      notifyError(cause, "数据清空失败");
    }
  };

  const saveTextMode = async (): Promise<boolean> => {
    let parsed: Record<string, string>;
    try {
      parsed = parseLocalCacheText(text);
    } catch (cause) {
      notifyError(cause, "文本格式无效");
      return false;
    }
    if (await persist(parsed)) {
      setDirtyText(false);
      setSelectedKey(Object.keys(parsed)[0]);
      notify({ kind: "success", message: "文本数据已保存" });
      return true;
    }
    return false;
  };

  const switchMode = async () => {
    if (pageMode === "structured") {
      if (editing && !await saveEditing()) return;
      setText(formatLocalCacheText(valuesRef.current));
      setDirtyText(false);
      setPageMode("text");
      return;
    }
    if (dirtyText && !await saveTextMode()) return;
    setPageMode("structured");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(values, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `local-forwarder-${tab}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify({ kind: "success", message: "数据已导出" });
  };

  const importData = async (file: File) => {
    try {
      const raw = await file.text();
      let imported: Record<string, string>;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON 必须是对象");
        imported = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key.toUpperCase(), typeof value === "string" ? value : JSON.stringify(value)]));
      } catch {
        imported = parseLocalCacheText(raw);
      }
      if (await persist({ ...valuesRef.current, ...imported })) notify({ kind: "success", message: `已导入 ${Object.keys(imported).length} 项` });
    } catch (cause) {
      notifyError(cause, "数据导入失败");
    }
  };

  const scopeLabel = tab === "variables" ? "工作区共享" : selectedInstance?.name ?? "当前环境";
  const pageTitle = tab === "session" ? "action100/104/105请求缓存" : tab === "kv" ? "/reqsavemap" : tab === "files" ? "/reqsavefile" : tab === "variables" ? "APP原生缓存值" : "数据";
  const selectedDisplay = selectedEntry === undefined ? "" : editing ? draft : displayValue(tab, selectedEntry);
  const selectedMeta = selectedEntry === undefined ? "" : tab === "files" ? decodeFileCacheValue(selectedEntry.value) : selectedEntry.value;
  const selectedVariableLabel = tab === "variables" && selectedEntry !== undefined ? localVariableLabel(selectedEntry.key) : undefined;

  return <section className="lf-view-body">
    <header className="lf-page-head">
      <div>
        <p className="lf-page-eyebrow">{`Data · ${tabs.find((item) => item.tab === tab)?.label ?? "Browser"}`}</p>
        <div className="lf-page-title-line"><h1>{pageTitle}</h1><span className="lf-scope-pill"><span className={`lf-status-dot ${tab === "variables" ? "" : selectedInstance?.status.state === "running" ? "running" : "stopped"}`} />{tab === "variables" ? <><strong>工作区</strong><span>· 全局共享</span></> : <><strong>{scopeLabel}</strong><span>· 数据随环境切换</span></>}</span></div>
        <p className="lf-page-sub">登录缓存、本地缓存、文件缓存与本地变量共用一套浏览、筛选和编辑体验。</p>
      </div>
      <div className="lf-page-actions">
        <input ref={importRef} hidden type="file" accept=".json,.txt,text/plain,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file !== undefined) void importData(file); event.target.value = ""; }} />
        <button className="lf-btn" type="button" onClick={() => importRef.current?.click()}>导入</button>
        <button className="lf-btn primary" type="button" onClick={startAdd}>＋ 新增</button>
      </div>
    </header>

    <section className="lf-panel lf-data-shell">
      <div className="lf-data-top">
        <div className="lf-data-tabs" role="tablist" aria-label="数据类型">
          {tabs.map((item) => <button className={`lf-data-tab ${tab === item.tab ? "active" : ""}`} type="button" role="tab" aria-selected={tab === item.tab} key={item.tab} onClick={() => onNavigate(item.route)}><WorkspaceIcon name={item.tab === "session" ? "session" : item.tab === "kv" ? "kv" : item.tab === "files" ? "files" : "variables"} className="lf-icon lf-icon-sm" />{item.label}<span className="lf-tab-count">{counts[item.tab]}</span></button>)}
        </div>
        <div className="lf-data-scope"><span className={`lf-status-dot ${tab === "variables" ? "" : selectedInstance?.status.state === "running" ? "running" : "stopped"}`} /><strong>{scopeLabel}</strong><span>· {tab === "variables" ? "所有环境共享" : "数据随环境切换"}</span></div>
      </div>
      <div className="lf-data-toolbar">
        <label className="lf-search-control"><WorkspaceIcon name="search" className="lf-icon" /><input type="search" placeholder={tab === "variables" ? "搜索变量名、业务标签或值" : "搜索键名或值"} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="lf-filter-chips">
          {([['all', `全部 ${stats.total}`], ['value', `有值 ${stats.nonEmpty}`], ['json', `JSON ${stats.json}`], ['empty', `空值 ${stats.empty}`]] as const).map(([value, label]) => <button className={`lf-chip ${filter === value ? "active" : ""}`} type="button" key={value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <div className="lf-toolbar-spacer" />
        <div className="lf-segmented lf-data-mode" role="group" aria-label="视图模式"><button className={pageMode === "structured" ? "active" : ""} type="button" onClick={() => { if (pageMode !== "structured") void switchMode(); }}>结构化</button><button className={pageMode === "text" ? "active" : ""} type="button" onClick={() => { if (pageMode !== "text") void switchMode(); }}>文本</button></div>
        <button className="lf-btn small" type="button" onClick={exportData}>导出</button>
        <button className="lf-btn small danger" type="button" disabled={busy || stats.total === 0} onClick={() => void clearAll()}>清空</button>
      </div>

      {pageMode === "text" ? <section className="lf-data-text-panel">
        <div className="lf-data-text-head"><div><strong>文本模式</strong><span>每行一个“键 = 值”；空行后的续行归入上一个值。</span></div><button className="lf-btn primary small" type="button" disabled={!dirtyText || busy} onClick={() => void saveTextMode()}>保存文本</button></div>
        <textarea value={text} disabled={busy} spellCheck={false} onChange={(event) => { setText(event.target.value); setDirtyText(true); }} aria-label={`${tabs.find((item) => item.tab === tab)?.label}文本`} />
      </section> : <div className="lf-data-workspace">
        <div className="lf-data-list" role="listbox" aria-label="数据键列表">
          {!loaded ? <div className="lf-data-list-empty">正在读取…</div> : entries.length === 0 ? <div className="lf-data-list-empty">{stats.total === 0 ? "还没有数据。" : "没有匹配的数据项。"}</div> : entries.map((entry) => {
            const variableLabel = tab === "variables" ? localVariableLabel(entry.key) : undefined;
            return <button className={`lf-data-row ${entry.key === selectedKey ? "active" : ""}`} type="button" role="option" aria-selected={entry.key === selectedKey} key={entry.key} onClick={() => { setAdding(false); setEditing(false); setSelectedKey(entry.key); }}>
              <span className="lf-row-key-line"><span className="lf-row-key">{entry.key}</span><DataTypeBadge entry={entry} /><VariableLabelBadge label={variableLabel} /></span><span className="lf-row-meta">{formatLocalCacheCharCount(entry.chars)} 字符</span>
              {entry.kind !== "empty" && <span className="lf-row-preview">{entry.preview}</span>}
            </button>;
          })}
        </div>
        <section className="lf-data-detail">
          {adding ? <div className="lf-data-add-form">
            <div className="lf-detail-head"><div className="lf-detail-title"><h3>新增数据项</h3><p>{sourceCopy[tab]} · {scopeLabel}</p></div></div>
            <label><span>键名</span><input autoFocus value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="例如 USER_PROFILE" spellCheck={false} /></label>
            <label><span>值</span><textarea value={newValue} onChange={(event) => setNewValue(event.target.value)} placeholder="输入原始内容，支持 JSON 和多行文本" spellCheck={false} /></label>
            <div className="lf-data-add-actions"><button className="lf-btn" type="button" onClick={() => setAdding(false)}>取消</button><button className="lf-btn primary" type="button" disabled={busy} onClick={() => void saveNew()}>添加并保存</button></div>
          </div> : selectedEntry === undefined ? <div className="lf-data-detail-empty"><WorkspaceIcon name="database" /><strong>{loaded ? "请选择一个数据项" : "正在读取数据…"}</strong><span>左侧选择键名后，可在此查看、编辑、复制或删除。</span></div> : <>
            <div className="lf-detail-head">
              <div className="lf-detail-title">
                <div className="lf-detail-title-line"><h3>{selectedEntry.key}</h3><DataTypeBadge entry={selectedEntry} /><VariableLabelBadge label={selectedVariableLabel} />{tab === "variables" && <span className="lf-type-badge global">全局</span>}</div>
                <p>{selectedEntry.chars.toLocaleString("zh-CN")} 字符{selectedEntry.isJson ? ` · ${selectedEntry.formattedLines} 行` : ""} · {scopeLabel}</p>
              </div>
              <div className="lf-detail-actions">
                <button className="lf-mini-action" type="button" title="复制完整值" aria-label="复制完整值" onClick={() => { void copyText(selectedMeta).then(() => notify({ kind: "success", message: `已复制 ${selectedEntry.key}` })).catch((cause) => notifyError(cause, "复制失败")); }}><WorkspaceIcon name="files" className="lf-icon lf-icon-sm" /></button>
                <button className="lf-mini-action danger" type="button" title="删除此键" aria-label="删除此键" disabled={busy} onClick={() => void deleteSelected()}><WorkspaceIcon name="close" className="lf-icon lf-icon-sm" /></button>
                {editing ? <><button className="lf-btn small" type="button" onClick={() => setEditing(false)}>取消</button><button className="lf-btn primary small" type="button" disabled={busy} onClick={() => void saveEditing()}>完成</button></> : <button className="lf-btn primary small" type="button" disabled={busy} onClick={() => { setDraft(tab === "files" ? decodeFileCacheValue(selectedEntry.value) : selectedEntry.value); setEditing(true); }}>编辑原文</button>}
              </div>
            </div>
            {editing ? <textarea className="lf-data-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label={`${selectedEntry.key} 的原始值`} /> : <pre className="lf-detail-code">{selectedDisplay || " "}</pre>}
            <div className="lf-detail-foot"><span>来源 <code>{sourceCopy[tab]}</code></span><span>{busy ? "正在保存…" : "已同步"} · {tab === "files" ? "文件缓存" : tab === "variables" ? "工作区作用域" : "当前环境"}</span></div>
          </>}
        </section>
      </div>}
    </section>
  </section>;
}
