import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFileCacheValue } from "../../shared/file-cache-value";
import { describeLocalCacheEntry, filterLocalCacheEntries, formatLocalCacheCharCount, localCacheStats, localCacheTypeBadge, type LocalCacheEntry, type LocalCacheFilter } from "../local-cache-data";
import { useToast } from "./ToastProvider";

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

function FileCacheTypeBadge({ entry, short = true }: { entry: LocalCacheEntry; short?: boolean }) {
  if (!short) {
    const className = entry.kind === "empty" ? "empty" : entry.isJson ? "json" : "text";
    return <span className={`local-cache-type ${className}`}>{entry.label}</span>;
  }
  const badge = localCacheTypeBadge(entry);
  return <span className={`local-cache-type ${badge.className}`}>{badge.label}</span>;
}

function FileCacheCodeView({ value, empty, ariaLabel }: { value: string; empty: boolean; ariaLabel: string }) {
  const lines = useMemo(() => value.split("\n"), [value]);
  if (empty) {
    return <div className="local-cache-value-empty"><strong>空文件</strong><span>该文件缓存内容为空。</span></div>;
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

export function FileCachePage({ instanceId }: { instanceId?: string }) {
  const { notify, notifyError } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LocalCacheFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("formatted");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const valuesRef = useRef<Record<string, string>>({});
  const instanceIdRef = useRef(instanceId);
  const dirtyRef = useRef(false);
  const interactingRef = useRef(false);
  const busyRef = useRef(false);
  const requestVersionRef = useRef(0);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);

  const applyValues = useCallback((next: Record<string, string>) => {
    const copy = { ...next };
    valuesRef.current = copy;
    setValues(copy);
  }, []);

  useEffect(() => {
    instanceIdRef.current = instanceId;
    requestVersionRef.current += 1;
    busyRef.current = false;
    valuesRef.current = {};
    setValues({});
    setSelectedKey(undefined);
    setQuery("");
    setFilter("all");
    setViewMode("formatted");
    setEditing(false);
    setDraft("");
    setAdding(false);
    setNewKey("");
    setNewValue("");
    dirtyRef.current = false;
    interactingRef.current = false;
    setDirty(false);
    setBusy(false);
    setLoaded(false);
    setConfirmingClear(false);
  }, [instanceId]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const version = ++requestVersionRef.current;
      try {
        const next = await window.forwarder.getFileValues(instanceId);
        if (!active || version !== requestVersionRef.current || busyRef.current || dirtyRef.current || interactingRef.current) return;
        applyValues(next);
        setLoaded(true);
      } catch (cause) {
        if (active) notifyError(cause, "文件缓存读取失败");
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
    if (confirmingClear) clearCancelRef.current?.focus();
  }, [confirmingClear]);

  useEffect(() => {
    if (!confirmingClear) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || busyRef.current) return;
      interactingRef.current = dirtyRef.current || editing || adding;
      setConfirmingClear(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [adding, confirmingClear, editing]);

  const entries = useMemo(() => filterLocalCacheEntries(values, query, filter), [values, query, filter]);
  const stats = useMemo(() => localCacheStats(values), [values]);
  const selectedEntry = selectedKey === undefined ? undefined : describeLocalCacheEntry(selectedKey, values[selectedKey] ?? "");
  const effectiveViewMode: ViewMode = selectedEntry?.isJson === true ? viewMode : "raw";
  const displayedValue = selectedEntry === undefined ? "" : effectiveViewMode === "formatted" ? selectedEntry.formatted : encodeFileCacheValue(selectedEntry.value);
  const statusText = busy ? "处理中…" : dirty ? "待保存" : loaded ? "已同步" : "读取中…";
  const statusTone = busy ? "saving" : dirty ? "dirty" : loaded ? "ready" : "loading";

  useEffect(() => {
    if (entries.length === 0) {
      if (selectedKey !== undefined) setSelectedKey(undefined);
      return;
    }
    if (selectedKey === undefined || !entries.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(entries[0]!.key);
    }
  }, [entries, selectedKey]);

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

  const startEditing = () => {
    if (selectedEntry === undefined) return;
    setViewMode("raw");
    setDraft(encodeFileCacheValue(selectedEntry.value));
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

  const persistValue = async (key: string, value: string): Promise<boolean> => {
    if (busyRef.current) return false;
    const targetInstanceId = instanceIdRef.current;
    const persistedValue = encodeFileCacheValue(value);
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await window.forwarder.saveFileValue(key, persistedValue, targetInstanceId);
      if (!result.ok) throw new Error(result.error ?? "文件缓存保存失败");
      if (instanceIdRef.current !== targetInstanceId) return false;
      requestVersionRef.current += 1;
      const normalized = key.toUpperCase();
      const next = { ...valuesRef.current };
      for (const existing of Object.keys(next)) {
        if (existing.toUpperCase() === normalized) delete next[existing];
      }
      next[normalized] = persistedValue;
      applyValues(next);
      dirtyRef.current = false;
      setDirty(false);
      return true;
    } catch (cause) {
      notifyError(cause, "文件缓存保存失败");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveDraft = async (): Promise<boolean> => {
    if (!editing || selectedEntry === undefined) return false;
    if (encodeFileCacheValue(draft) === encodeFileCacheValue(selectedEntry.value)) {
      setEditing(false);
      setDraft("");
      dirtyRef.current = false;
      interactingRef.current = false;
      setDirty(false);
      return true;
    }
    const saved = await persistValue(selectedEntry.key, draft);
    if (saved) {
      setSelectedKey(selectedEntry.key.toUpperCase());
      setEditing(false);
      setDraft("");
      interactingRef.current = false;
      notify({ kind: "success", message: `已保存 ${selectedEntry.key}` });
    }
    return saved;
  };

  const submitNewEntry = async () => {
    const key = newKey.trim().toUpperCase();
    if (key === "") {
      notifyError("文件名不能为空", "无法新增文件缓存");
      return;
    }
    if (key.includes("/") || key.includes("\\") || key === "." || key === "..") {
      notifyError("文件名不能包含路径分隔符", "无法新增文件缓存");
      return;
    }
    if (Object.keys(valuesRef.current).some((existing) => existing.toUpperCase() === key)) {
      notifyError(`文件“${key}”已存在`, "无法新增文件缓存");
      return;
    }
    const saved = await persistValue(key, newValue);
    if (!saved) return;
    setAdding(false);
    setNewKey("");
    setNewValue("");
    setSelectedKey(key);
    setFilter("all");
    setQuery("");
    setViewMode(describeLocalCacheEntry(key, newValue).isJson ? "formatted" : "raw");
    interactingRef.current = false;
    notify({ kind: "success", message: `已新增 ${key}` });
  };

  const deleteSelected = async () => {
    if (selectedEntry === undefined || busyRef.current) return;
    if (!window.confirm(`确定删除文件缓存“${selectedEntry.key}”吗？`)) return;
    const targetInstanceId = instanceIdRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await window.forwarder.deleteFileValue(selectedEntry.key, targetInstanceId);
      if (!result.ok) throw new Error(result.error ?? "文件缓存删除失败");
      if (instanceIdRef.current !== targetInstanceId) return;
      const next = { ...valuesRef.current };
      delete next[selectedEntry.key];
      applyValues(next);
      setEditing(false);
      setDraft("");
      setAdding(false);
      setNewKey("");
      setNewValue("");
      dirtyRef.current = false;
      interactingRef.current = false;
      setDirty(false);
      setSelectedKey(undefined);
      notify({ kind: "success", message: `已删除 ${selectedEntry.key}` });
    } catch (cause) {
      notifyError(cause, "文件缓存删除失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const openClearDialog = () => {
    if (busyRef.current || !loaded || stats.total === 0) return;
    interactingRef.current = true;
    setConfirmingClear(true);
  };

  const closeClearDialog = () => {
    if (busyRef.current) return;
    interactingRef.current = dirtyRef.current || editing || adding;
    setConfirmingClear(false);
  };

  const clearAll = async () => {
    if (busyRef.current) return;
    const targetInstanceId = instanceIdRef.current;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await window.forwarder.clearFileValues(targetInstanceId);
      if (!result.ok) throw new Error(result.error ?? "文件缓存清空失败");
      if (instanceIdRef.current !== targetInstanceId) return;
      applyValues({});
      setConfirmingClear(false);
      setSelectedKey(undefined);
      setEditing(false);
      setDraft("");
      setAdding(false);
      setNewKey("");
      setNewValue("");
      setQuery("");
      setFilter("all");
      setViewMode("formatted");
      dirtyRef.current = false;
      interactingRef.current = false;
      setDirty(false);
      notify({ kind: "success", message: "文件缓存已清空" });
    } catch (cause) {
      notifyError(cause, "文件缓存清空失败");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const copySelected = async () => {
    if (selectedEntry === undefined) return;
    try {
      await copyTextToClipboard(encodeFileCacheValue(selectedEntry.value));
      notify({ kind: "success", message: `已复制 ${selectedEntry.key}` });
    } catch (cause) {
      notifyError(cause, "复制文件缓存失败");
    }
  };

  return <section className="panel local-cache-page">
    <div className="local-cache-heading">
      <div className="local-cache-heading-title">
        <h2>文件缓存</h2>
        <span className="local-cache-api-pill">/reqsavefile</span>
        <span className={`local-cache-status ${statusTone}`} aria-live="polite"><i />{statusText}</span>
      </div>
      <div className="local-cache-heading-actions">
        <button type="button" className="local-cache-button primary" onClick={openAdd} disabled={busy || !loaded}>＋ 新增</button>
        <span className="local-cache-action-separator" aria-hidden="true" />
        <button type="button" className="local-cache-button danger" onClick={openClearDialog} onMouseDown={(event) => event.preventDefault()} disabled={busy || !loaded || stats.total === 0}>清空缓存</button>
      </div>
    </div>

    <div className="local-cache-toolbar">
      <label className="local-cache-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名或内容" aria-label="搜索文件缓存" /></label>
      <div className="local-cache-filters" aria-label="文件缓存筛选">
        <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {stats.total}</button>
        <button type="button" className={filter === "value" ? "active" : ""} onClick={() => setFilter("value")}>有值 {stats.nonEmpty}</button>
        <button type="button" className={filter === "empty" ? "active" : ""} onClick={() => setFilter("empty")}>空文件 {stats.empty}</button>
        <button type="button" className={filter === "json" ? "active" : ""} onClick={() => setFilter("json")}>JSON {stats.json}</button>
      </div>
    </div>

    <div className="local-cache-workspace">
      <section className="local-cache-key-panel" aria-label="文件缓存列表">
        <div className="local-cache-key-list" role="listbox" aria-label="文件缓存">
          {entries.map((entry) => {
            const badge = localCacheTypeBadge(entry);
            return <button type="button" role="option" aria-selected={entry.key === selectedKey} className={`local-cache-key-row ${entry.key === selectedKey ? "selected" : ""}`} key={entry.key} onClick={() => selectEntry(entry)} title={`${entry.key}\n${entry.preview}`}>
              <span className="local-cache-key-copy"><span className="local-cache-key-name">{entry.key}</span><span className={`local-cache-key-preview ${entry.kind === "empty" ? "empty" : ""}`}>{entry.preview}</span></span>
              <span className="local-cache-key-meta"><span className={`local-cache-type ${badge.className}`}>{badge.label}</span><span className="local-cache-char-count">{formatLocalCacheCharCount(entry.chars)}</span></span>
            </button>;
          })}
          {entries.length === 0 && <div className="local-cache-list-empty">{!loaded ? "正在读取文件缓存…" : stats.total === 0 ? "暂无文件缓存" : "没有匹配的文件缓存"}</div>}
        </div>
      </section>

      <section className="local-cache-detail-panel">
        {adding ? <form className="local-cache-add-form" onSubmit={(event) => { event.preventDefault(); void submitNewEntry(); }}>
          <div className="local-cache-detail-heading"><div><h3>新增文件缓存</h3></div></div>
          <label className="local-cache-add-key">文件名<input value={newKey} onChange={(event) => { setNewKey(event.target.value); dirtyRef.current = true; setDirty(true); }} placeholder="例如 INDEX.HTML" spellCheck={false} /></label>
          <label className="local-cache-add-value">内容<textarea value={newValue} onChange={(event) => { setNewValue(event.target.value); dirtyRef.current = true; setDirty(true); }} rows={10} placeholder="输入原始缓存内容，保存时自动 encodeURI" spellCheck={false} /></label>
          <div className="local-cache-add-actions"><button type="button" className="local-cache-button" onClick={cancelAdd}>取消</button><button type="submit" className="local-cache-button primary" disabled={busy}>添加并保存</button></div>
        </form> : selectedEntry === undefined ? <div className="local-cache-detail-empty"><strong>{!loaded ? "正在读取文件缓存…" : stats.total === 0 ? "暂无文件缓存" : "请选择一个文件"}</strong><span>选择左侧文件名查看内容。</span></div> : <>
          <div className="local-cache-detail-heading">
            <div className="local-cache-detail-title"><h3>{selectedEntry.key}</h3><div className="local-cache-detail-meta"><FileCacheTypeBadge entry={selectedEntry} short={false} />{selectedEntry.isLong && <span className="local-cache-type long">超长</span>}<span>{selectedEntry.chars.toLocaleString("zh-CN")} 字符</span>{selectedEntry.isJson && <><span>·</span><span>格式化后 {selectedEntry.formattedLines} 行</span></>}</div></div>
            <div className="local-cache-detail-actions">
              <button type="button" className="local-cache-icon-button" title="复制完整内容" aria-label="复制完整内容" onClick={() => void copySelected()} disabled={busy}>⧉</button>
              {!editing && <button type="button" className="local-cache-icon-button danger" title="删除此文件缓存" aria-label="删除此文件缓存" onClick={() => void deleteSelected()} disabled={busy}>×</button>}
              {editing ? <><button type="button" className="local-cache-button" onMouseDown={(event) => event.preventDefault()} onClick={cancelEditing}>取消</button><button type="button" className="local-cache-button primary" disabled={busy} onMouseDown={(event) => event.preventDefault()} onClick={() => void saveDraft()}>完成</button></> : <button type="button" className="local-cache-button primary" onClick={startEditing} disabled={busy}>编辑原文</button>}
            </div>
          </div>
          {!editing && <div className="local-cache-view-tabs"><button type="button" className={effectiveViewMode === "formatted" ? "active" : ""} title="decodeURIComponent 后格式化 JSON" disabled={!selectedEntry.isJson} onClick={() => setViewMode("formatted")}>格式化</button><button type="button" className={effectiveViewMode === "raw" ? "active" : ""} title="encodeURI 后的原始存储内容" onClick={() => setViewMode("raw")}>原文</button></div>}
          {editing ? <textarea ref={editRef} className="local-cache-value-editor" aria-label={`${selectedEntry.key} 的原始内容`} value={draft} onChange={(event) => { setDraft(event.target.value); dirtyRef.current = true; setDirty(true); }} spellCheck={false} /> : <FileCacheCodeView value={displayedValue} empty={selectedEntry.kind === "empty"} ariaLabel={`${selectedEntry.key} 的文件缓存内容`} />}
        </>}
      </section>
    </div>

    {confirmingClear && <div className="local-cache-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeClearDialog(); }}>
      <div className="local-cache-dialog" role="dialog" aria-modal="true" aria-labelledby="file-cache-clear-title" aria-describedby="file-cache-clear-description">
        <div className="local-cache-dialog-heading">
          <div className="local-cache-dialog-icon" aria-hidden="true">!</div>
          <div><h3 id="file-cache-clear-title">清空文件缓存</h3><p>当前代理 · 文件缓存</p></div>
        </div>
        <div className="local-cache-dialog-body">
          <p id="file-cache-clear-description">确定清空当前代理的全部文件缓存吗？其他端口不受影响，此操作不可撤销。</p>
          <div className="local-cache-dialog-summary"><span>将删除当前代理的全部文件缓存</span><strong>{stats.total} 个文件</strong></div>
        </div>
        <div className="local-cache-dialog-actions">
          <button ref={clearCancelRef} type="button" className="local-cache-button" onClick={closeClearDialog} disabled={busy}>取消</button>
          <button type="button" className="local-cache-button danger-solid" onClick={() => void clearAll()} disabled={busy}>{busy ? "清空中…" : "清空缓存"}</button>
        </div>
      </div>
    </div>}
  </section>;
}
