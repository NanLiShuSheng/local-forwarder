import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatLocalCacheText, parseLocalCacheText } from "../../shared/local-cache";
import { describeLocalCacheEntry, filterLocalCacheEntries, formatLocalCacheCharCount, localCacheStats, localCacheTypeBadge, type LocalCacheEntry, type LocalCacheFilter } from "../local-cache-data";
import { useToast } from "./ToastProvider";

type PageMode = "structured" | "text";
type ViewMode = "formatted" | "raw";

async function copyTextToClipboard(text: string): Promise<void> {
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

function LocalCacheTypeBadge({ entry, short = true }: { entry: LocalCacheEntry; short?: boolean }) {
  if (!short) {
    const className = entry.kind === "empty" ? "empty" : entry.isJson ? "json" : "text";
    return <span className={`local-cache-type ${className}`}>{entry.label}</span>;
  }
  const badge = localCacheTypeBadge(entry);
  return <span className={`local-cache-type ${badge.className}`}>{badge.label}</span>;
}

function LocalCacheCodeView({ value, empty, ariaLabel }: { value: string; empty: boolean; ariaLabel: string }) {
  const lines = useMemo(() => value.split("\n"), [value]);
  if (empty) {
    return <div className="local-cache-value-empty"><strong>空值</strong><span>点击“编辑原文”写入内容。</span></div>;
  }
  return <div className="local-cache-code-shell" role="region" aria-label={ariaLabel}>
    <div className="local-cache-code-scroll">
      {lines.map((line, index) => <div className="local-cache-code-line" key={index}>
        <span className="local-cache-line-number" aria-hidden="true">{index + 1}</span>
        <span className="local-cache-line-content">{line === "" ? " " : line}</span>
      </div>)}
    </div>
  </div>;
}

export function LocalCachePage({ instanceId }: { instanceId?: string }) {
  const { notify, notifyError } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LocalCacheFilter>("all");
  const [pageMode, setPageMode] = useState<PageMode>("structured");
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const valuesRef = useRef<Record<string, string>>({});
  const instanceIdRef = useRef(instanceId);
  const dirtyRef = useRef(false);
  const interactingRef = useRef(false);
  const busyRef = useRef(false);
  const requestVersionRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const applyValues = useCallback((next: Record<string, string>) => {
    const copy = { ...next };
    valuesRef.current = copy;
    setValues(copy);
    setText(formatLocalCacheText(copy));
  }, []);

  useEffect(() => {
    instanceIdRef.current = instanceId;
    requestVersionRef.current += 1;
    dirtyRef.current = false;
    interactingRef.current = false;
    busyRef.current = false;
    valuesRef.current = {};
    setValues({});
    setSelectedKey(undefined);
    setQuery("");
    setFilter("all");
    setPageMode("structured");
    setViewMode("formatted");
    setEditing(false);
    setDraft("");
    setText("");
    setAdding(false);
    setNewKey("");
    setNewValue("");
    setBusy(false);
    setDirty(false);
    setLoaded(false);
  }, [instanceId]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const version = ++requestVersionRef.current;
      try {
        const next = await window.forwarder.getMapValues(instanceId);
        if (!active || version !== requestVersionRef.current || dirtyRef.current || interactingRef.current || busyRef.current) return;
        applyValues(next);
        setLoaded(true);
      } catch (cause) {
        if (active) notifyError(cause, "本地缓存读取失败");
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [instanceId, notifyError, applyValues]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if (pageMode !== "structured" || (!event.metaKey && !event.ctrlKey) || event.key.toLocaleLowerCase() !== "f") return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", handleFind);
    return () => window.removeEventListener("keydown", handleFind);
  }, [pageMode]);

  const entries = useMemo(() => filterLocalCacheEntries(values, query, filter), [values, query, filter]);
  const stats = useMemo(() => localCacheStats(values), [values]);
  const selectedEntry = selectedKey === undefined ? undefined : describeLocalCacheEntry(selectedKey, values[selectedKey] ?? "");
  const effectiveViewMode: ViewMode = selectedEntry?.isJson === true ? viewMode : "raw";
  const displayedValue = selectedEntry === undefined ? "" : effectiveViewMode === "formatted" ? selectedEntry.formatted : selectedEntry.value;
  const statusText = busy ? "保存中…" : dirty ? "待保存" : loaded ? "已同步" : "读取中…";
  const statusTone = busy ? "saving" : dirty ? "dirty" : loaded ? "ready" : "loading";

  useEffect(() => {
    if (adding) return;
    if (entries.length === 0) {
      if (selectedKey !== undefined || editing) {
        setSelectedKey(undefined);
        setEditing(false);
        setDraft("");
        dirtyRef.current = false;
        interactingRef.current = false;
        setDirty(false);
      }
      return;
    }
    if (selectedKey === undefined || !entries.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(entries[0]!.key);
      setEditing(false);
      setDraft("");
      dirtyRef.current = false;
      interactingRef.current = false;
      setDirty(false);
    }
  }, [adding, editing, entries, selectedKey]);

  const persistValues = async (next: Record<string, string>): Promise<boolean> => {
    if (busyRef.current) return false;
    const targetInstanceId = instanceIdRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await window.forwarder.saveMapValues(next, targetInstanceId);
      if (!result.ok) throw new Error(result.error ?? "本地缓存保存失败");
      if (instanceIdRef.current !== targetInstanceId) return false;
      requestVersionRef.current += 1;
      dirtyRef.current = false;
      setDirty(false);
      applyValues(next);
      return true;
    } catch (cause) {
      notifyError(cause, "本地缓存保存失败");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const selectEntry = (entry: LocalCacheEntry) => {
    if (adding) {
      setAdding(false);
      setNewKey("");
      setNewValue("");
      dirtyRef.current = false;
      interactingRef.current = false;
      setDirty(false);
    }
    if (entry.key === selectedKey) return;
    setEditing(false);
    setDraft("");
    dirtyRef.current = false;
    interactingRef.current = false;
    setDirty(false);
    setSelectedKey(entry.key);
    setViewMode(entry.isJson ? "formatted" : "raw");
  };

  const startEditing = () => {
    if (selectedEntry === undefined) return;
    setViewMode("raw");
    setDraft(selectedEntry.value);
    setEditing(true);
    dirtyRef.current = false;
    interactingRef.current = true;
    setDirty(false);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft("");
    dirtyRef.current = false;
    interactingRef.current = false;
    setDirty(false);
  };

  const saveValue = async (): Promise<boolean> => {
    if (!editing || selectedEntry === undefined) return false;
    if (draft === selectedEntry.value) {
      setEditing(false);
      interactingRef.current = false;
      return true;
    }
    const next = { ...valuesRef.current, [selectedEntry.key]: draft };
    const saved = await persistValues(next);
    if (saved) {
      setEditing(false);
      interactingRef.current = false;
    }
    return saved;
  };

  const saveTextMode = async (): Promise<boolean> => {
    let parsed: Record<string, string>;
    try {
      parsed = parseLocalCacheText(text);
    } catch (cause) {
      notifyError(cause, "本地缓存格式无效");
      return false;
    }
    const saved = await persistValues(parsed);
    if (saved) setSelectedKey((current) => current !== undefined && parsed[current] !== undefined ? current : Object.keys(parsed)[0]);
    return saved;
  };

  const toggleMode = async () => {
    if (busyRef.current) return;
    if (adding) {
      notify({ kind: "warning", message: "请先完成或取消新增键值" });
      return;
    }
    if (pageMode === "structured") {
      if (editing && !(await saveValue())) return;
      setAdding(false);
      interactingRef.current = false;
      setPageMode("text");
      setText(formatLocalCacheText(valuesRef.current));
      return;
    }
    if (dirtyRef.current && !(await saveTextMode())) return;
    setPageMode("structured");
  };

  const openAdd = () => {
    if (busyRef.current) return;
    setEditing(false);
    setDraft("");
    setAdding(true);
    setNewKey("");
    setNewValue("");
    setFilter("all");
    setQuery("");
    dirtyRef.current = false;
    interactingRef.current = true;
    setDirty(false);
  };

  const cancelAdd = () => {
    setAdding(false);
    setNewKey("");
    setNewValue("");
    dirtyRef.current = false;
    interactingRef.current = false;
    setDirty(false);
  };

  const submitNewEntry = async () => {
    const key = newKey.trim().toUpperCase();
    if (key === "") {
      notifyError("键名不能为空", "无法新增缓存");
      return;
    }
    if (/[=\r\n]/.test(key)) {
      notifyError("键名不能包含等号或换行", "无法新增缓存");
      return;
    }
    if (valuesRef.current[key] !== undefined) {
      notifyError(`键“${key}”已存在`, "无法新增缓存");
      return;
    }
    const next = { ...valuesRef.current, [key]: newValue };
    const saved = await persistValues(next);
    if (!saved) return;
    setAdding(false);
    setNewKey("");
    setNewValue("");
    setSelectedKey(key);
    setFilter("all");
    setQuery("");
    setViewMode(describeLocalCacheEntry(key, newValue).isJson ? "formatted" : "raw");
    interactingRef.current = false;
  };

  const deleteSelected = async () => {
    if (selectedEntry === undefined || busyRef.current) return;
    if (!window.confirm(`确定删除缓存键“${selectedEntry.key}”吗？`)) return;
    const next = { ...valuesRef.current };
    delete next[selectedEntry.key];
    const saved = await persistValues(next);
    if (!saved) return;
    setEditing(false);
    setDraft("");
    setSelectedKey(undefined);
    interactingRef.current = false;
  };

  const copySelected = async () => {
    if (selectedEntry === undefined) return;
    try {
      await copyTextToClipboard(selectedEntry.value);
      notify({ kind: "success", message: `已复制 ${selectedEntry.key}` });
    } catch (cause) {
      notifyError(cause, "复制缓存值失败");
    }
  };

  return <section className="panel local-cache-page">
    <div className="local-cache-heading">
      <div className="local-cache-heading-title">
        <h2>本地缓存</h2>
        <span className={`local-cache-status ${statusTone}`} aria-live="polite"><i />{statusText}</span>
      </div>
      <div className="local-cache-heading-actions">
        {pageMode === "structured" && <button type="button" className="local-cache-button primary" onClick={openAdd} disabled={busy || !loaded}>＋ 新增</button>}
        <button type="button" className="local-cache-button" onClick={() => void toggleMode()} onMouseDown={(event) => event.preventDefault()} disabled={!loaded || busy}>{pageMode === "structured" ? "文本模式" : "结构化模式"}</button>
      </div>
    </div>

    {pageMode === "structured" ? <div className="local-cache-toolbar">
      <label className="local-cache-search"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索键或值" aria-label="搜索本地缓存" /></label>
      <div className="local-cache-filters" aria-label="缓存筛选">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {stats.total}</button>
        <button type="button" className={filter === "value" ? "active" : ""} onClick={() => setFilter("value")}>有值 {stats.nonEmpty}</button>
        <button type="button" className={filter === "empty" ? "active" : ""} onClick={() => setFilter("empty")}>空值 {stats.empty}</button>
        <button type="button" className={filter === "json" ? "active" : ""} onClick={() => setFilter("json")}>JSON {stats.json}</button>
      </div>
    </div> : <div className="local-cache-text-toolbar"><strong>文本模式</strong><span>每行一个“键 = 值”；空行后的续行归入上一个值。</span><span className="local-cache-text-count">{stats.total} 项</span></div>}

    {pageMode === "text" ? <div className="local-cache-text-panel">
      <textarea className="config-textarea local-cache-input" aria-label="本地缓存文本编辑" value={text} disabled={busy || !loaded} onChange={(event) => { dirtyRef.current = true; setDirty(true); setText(event.target.value); }} onBlur={() => { if (dirtyRef.current) void saveTextMode(); }} placeholder={"KEY = value\nAnotherKey = another value"} rows={18} spellCheck={false} />
    </div> : <div className="local-cache-workspace">
      <section className="local-cache-key-panel" aria-label="缓存键列表">
        <div className="local-cache-key-list" role="listbox" aria-label="缓存键">
          {entries.map((entry) => {
            const badge = localCacheTypeBadge(entry);
            return <button type="button" role="option" aria-selected={entry.key === selectedKey} className={`local-cache-key-row ${entry.key === selectedKey ? "selected" : ""}`} key={entry.key} onClick={() => selectEntry(entry)} title={`${entry.key}\n${entry.preview}`}>
              <span className="local-cache-key-copy"><span className="local-cache-key-name">{entry.key}</span><span className={`local-cache-key-preview ${entry.kind === "empty" ? "empty" : ""}`}>{entry.preview}</span></span>
              <span className="local-cache-key-meta"><span className={`local-cache-type ${badge.className}`}>{badge.label}</span><span className="local-cache-char-count">{formatLocalCacheCharCount(entry.chars)}</span></span>
            </button>;
          })}
          {entries.length === 0 && <div className="local-cache-list-empty">{!loaded ? "正在读取缓存…" : stats.total === 0 ? "暂无缓存" : "没有匹配的缓存键"}</div>}
        </div>
      </section>

      <section className="local-cache-detail-panel">
        {adding ? <form className="local-cache-add-form" onSubmit={(event) => { event.preventDefault(); void submitNewEntry(); }}>
          <div className="local-cache-detail-heading"><div><h3>新增键值</h3></div></div>
          <label className="local-cache-add-key">键名<input value={newKey} onChange={(event) => { setNewKey(event.target.value); dirtyRef.current = true; setDirty(true); }} placeholder="例如 TOKEN" spellCheck={false} /></label>
          <label className="local-cache-add-value">值<textarea value={newValue} onChange={(event) => { setNewValue(event.target.value); dirtyRef.current = true; setDirty(true); }} rows={10} placeholder="输入原始缓存内容，支持多行" spellCheck={false} /></label>
          <div className="local-cache-add-actions"><button type="button" className="local-cache-button" onClick={cancelAdd}>取消</button><button type="submit" className="local-cache-button primary" disabled={busy}>添加并保存</button></div>
        </form> : selectedEntry === undefined ? <div className="local-cache-detail-empty"><strong>{!loaded ? "正在读取缓存…" : stats.total === 0 ? "暂无缓存" : "请选择一个键"}</strong><span>选择左侧键名查看内容。</span></div> : <>
          <div className="local-cache-detail-heading">
            <div className="local-cache-detail-title"><h3>{selectedEntry.key}</h3><div className="local-cache-detail-meta"><LocalCacheTypeBadge entry={selectedEntry} short={false} />{selectedEntry.isLong && <span className="local-cache-type long">超长</span>}<span>{selectedEntry.chars.toLocaleString("zh-CN")} 字符</span>{selectedEntry.isJson && <><span>·</span><span>格式化后 {selectedEntry.formattedLines} 行</span></>}</div></div>
            <div className="local-cache-detail-actions">
              <button type="button" className="local-cache-icon-button" title="复制完整值" aria-label="复制完整值" onClick={() => void copySelected()} disabled={busy}>⧉</button>
              {!editing && <button type="button" className="local-cache-icon-button danger" title="删除此键" aria-label="删除此键" onClick={() => void deleteSelected()} disabled={busy}>×</button>}
              {editing ? <><button type="button" className="local-cache-button" onMouseDown={(event) => event.preventDefault()} onClick={cancelEditing}>取消</button><button type="button" className="local-cache-button primary" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void saveValue()}>完成</button></> : <button type="button" className="local-cache-button primary" onClick={startEditing} disabled={busy}>编辑原文</button>}
            </div>
          </div>
          {!editing && <div className="local-cache-view-tabs"><button type="button" className={effectiveViewMode === "formatted" ? "active" : ""} disabled={!selectedEntry.isJson} onClick={() => setViewMode("formatted")}>格式化</button><button type="button" className={effectiveViewMode === "raw" ? "active" : ""} onClick={() => setViewMode("raw")}>原文</button></div>}
          {editing ? <textarea ref={editRef} className="local-cache-value-editor" aria-label={`${selectedEntry.key} 的原始值`} value={draft} onChange={(event) => { setDraft(event.target.value); dirtyRef.current = true; setDirty(true); }} onBlur={() => { if (dirtyRef.current) void saveValue(); else { setEditing(false); interactingRef.current = false; } }} spellCheck={false} /> : <LocalCacheCodeView value={displayedValue} empty={selectedEntry.kind === "empty"} ariaLabel={`${selectedEntry.key} 的缓存内容`} />}
        </>}
      </section>
    </div>}
  </section>;
}
