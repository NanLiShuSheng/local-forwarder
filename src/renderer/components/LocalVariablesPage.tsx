import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatLocalCacheText, parseLocalCacheText } from "../../shared/local-cache";
import { formatLocalCacheCharCount } from "../local-cache-data";
import { describeLocalVariable, localVariableEntries, localVariableKeyError, localVariableLabel, localVariableStats, normalizeLocalVariableKey, type LocalVariableEntry, type LocalVariableFilter } from "../local-variable-data";
import { useToast } from "./ToastProvider";

type PageMode = "structured" | "text";

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

function CopyIcon() {
  return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="7.5" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.15" /><path d="M10.5 5V3.7c0-.66-.54-1.2-1.2-1.2H4.2C3.54 2.5 3 3.04 3 3.7v6.4c0 .66.54 1.2 1.2 1.2H5" stroke="currentColor" strokeWidth="1.15" /></svg>;
}

function VariableTypeBadge({ entry, editing = false }: { entry: LocalVariableEntry; editing?: boolean }) {
  if (editing) return <span className="local-variables-type edit">编辑中</span>;
  if (entry.chars === 0) return <span className="local-variables-type empty">空值</span>;
  if (entry.isLong) return <span className="local-variables-type long">长文本</span>;
  return null;
}

export function LocalVariablesPage({ active = true }: { active?: boolean }) {
  const { notify, notifyError } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedKey, setSelectedKey] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LocalVariableFilter>("all");
  const [pageMode, setPageMode] = useState<PageMode>("structured");
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<string | undefined>();
  const valuesRef = useRef<Record<string, string>>({});
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const valueEditorRef = useRef<HTMLTextAreaElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);

  const applyValues = useCallback((next: Record<string, string>) => {
    const copy = { ...next };
    valuesRef.current = copy;
    setValues(copy);
    setText(formatLocalCacheText(copy));
  }, []);

  useEffect(() => {
    let active = true;
    void window.forwarder.getSharedValues().then((next) => {
      if (!active) return;
      applyValues(next);
      setLoaded(true);
    }).catch((cause) => {
      if (active) notifyError(cause, "本地变量读取失败");
    });
    return () => { active = false; };
  }, [applyValues, notifyError]);

  useEffect(() => {
    if (adding) nameInputRef.current?.focus();
    else if (editing) valueEditorRef.current?.focus();
  }, [adding, editing]);

  useEffect(() => {
    if (deleteCandidate !== undefined) deleteCancelRef.current?.focus();
  }, [deleteCandidate]);

  const entries = useMemo(() => localVariableEntries(values, query, filter), [values, query, filter]);
  const stats = useMemo(() => localVariableStats(values), [values]);
  const selectedEntry = selectedKey === undefined ? undefined : describeLocalVariable(selectedKey, values[selectedKey] ?? "");
  const statusText = busy ? "保存中…" : dirty ? "未保存" : loaded ? "已同步" : "读取中…";
  const statusTone = busy ? "saving" : dirty ? "dirty" : loaded ? "ready" : "loading";

  useEffect(() => {
    if (!loaded || editing || adding) return;
    if (entries.length === 0) {
      setSelectedKey(undefined);
      return;
    }
    if (selectedKey === undefined || !entries.some((entry) => entry.key === selectedKey)) setSelectedKey(entries[0]!.key);
  }, [adding, editing, entries, loaded, selectedKey]);

  const persistValues = async (next: Record<string, string>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await window.forwarder.saveSharedValues(next);
      if (!result.ok) throw new Error(result.error ?? "本地变量保存失败");
      dirtyRef.current = false;
      setDirty(false);
      applyValues(next);
      return true;
    } catch (cause) {
      notifyError(cause, "本地变量保存失败");
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const resetDraft = () => {
    setEditing(false);
    setAdding(false);
    setDraftKey("");
    setDraftValue("");
    dirtyRef.current = false;
    setDirty(false);
  };

  const selectEntry = (entry: LocalVariableEntry) => {
    if (entry.key === selectedKey && !adding && !editing) return;
    if ((adding || editing) && dirtyRef.current && !window.confirm("当前修改尚未保存，切换后将丢失。继续？")) return;
    resetDraft();
    setSelectedKey(entry.key);
  };

  const startEditing = () => {
    if (selectedEntry === undefined || busyRef.current) return;
    setAdding(false);
    setEditing(true);
    setDraftKey(selectedEntry.key);
    setDraftValue(selectedEntry.value);
    dirtyRef.current = false;
    setDirty(false);
  };

  const beginAdd = () => {
    if (busyRef.current) return;
    setEditing(false);
    setAdding(true);
    setDraftKey("");
    setDraftValue("");
    setQuery("");
    setFilter("all");
    dirtyRef.current = false;
    setDirty(false);
  };

  const cancelEditing = () => {
    if (busyRef.current) return;
    resetDraft();
  };

  const updateDraftKey = (value: string) => {
    setDraftKey(value);
    dirtyRef.current = true;
    setDirty(true);
  };

  const updateDraftValue = (value: string) => {
    setDraftValue(value);
    dirtyRef.current = true;
    setDirty(true);
  };

  const saveEditing = async (): Promise<boolean> => {
    if (!editing || selectedEntry === undefined || busyRef.current) return false;
    const key = normalizeLocalVariableKey(draftKey);
    const keyError = localVariableKeyError(key, valuesRef.current, selectedEntry.key);
    if (keyError !== undefined) {
      notifyError(keyError, "无法保存变量");
      return false;
    }
    if (key === selectedEntry.key && draftValue === selectedEntry.value) {
      resetDraft();
      return true;
    }
    const next = { ...valuesRef.current };
    if (key !== selectedEntry.key) delete next[selectedEntry.key];
    next[key] = draftValue;
    const saved = await persistValues(next);
    if (!saved) return false;
    setSelectedKey(key);
    resetDraft();
    notify({ kind: "success", message: `变量 ${key} 已保存` });
    return true;
  };

  const saveNew = async (): Promise<boolean> => {
    if (!adding || busyRef.current) return false;
    const key = normalizeLocalVariableKey(draftKey);
    const keyError = localVariableKeyError(key, valuesRef.current);
    if (keyError !== undefined) {
      notifyError(keyError, "无法新增变量");
      return false;
    }
    const saved = await persistValues({ ...valuesRef.current, [key]: draftValue });
    if (!saved) return false;
    setSelectedKey(key);
    resetDraft();
    notify({ kind: "success", message: `变量 ${key} 已新增` });
    return true;
  };

  const saveTextMode = async (showSuccess = true): Promise<boolean> => {
    let parsed: Record<string, string>;
    try {
      parsed = parseLocalCacheText(text);
    } catch (cause) {
      notifyError(cause, "本地变量格式无效");
      return false;
    }
    const saved = await persistValues(parsed);
    if (!saved) return false;
    setSelectedKey((current) => current !== undefined && parsed[current] !== undefined ? current : Object.keys(parsed)[0]);
    if (showSuccess) notify({ kind: "success", message: `已保存 ${Object.keys(parsed).length} 个本地变量` });
    return true;
  };

  const toggleMode = async () => {
    if (busyRef.current) return;
    if (pageMode === "structured") {
      if (adding) {
        notify({ kind: "warning", message: "请先完成或取消新增变量" });
        return;
      }
      if (editing && dirtyRef.current && !(await saveEditing())) return;
      resetDraft();
      setText(formatLocalCacheText(valuesRef.current));
      dirtyRef.current = false;
      setDirty(false);
      setPageMode("text");
      return;
    }
    if (dirtyRef.current && !(await saveTextMode(false))) return;
    setText(formatLocalCacheText(valuesRef.current));
    dirtyRef.current = false;
    setDirty(false);
    setPageMode("structured");
  };

  const openDelete = (key: string) => {
    if (busyRef.current) return;
    setDeleteCandidate(key);
  };

  const confirmDelete = async () => {
    if (deleteCandidate === undefined || busyRef.current) return;
    const key = deleteCandidate;
    const next = { ...valuesRef.current };
    delete next[key];
    const saved = await persistValues(next);
    if (!saved) return;
    resetDraft();
    setSelectedKey(undefined);
    setDeleteCandidate(undefined);
    notify({ kind: "success", message: `变量 ${key} 已删除` });
  };

  const copyValue = async () => {
    if (selectedEntry === undefined) return;
    try {
      await copyTextToClipboard(selectedEntry.value);
      notify({ kind: "success", message: `已复制 ${selectedEntry.key} 的值` });
    } catch (cause) {
      notifyError(cause, "复制变量值失败");
    }
  };

  const copyPlaceholder = async (key: string) => {
    try {
      await copyTextToClipboard(`(${key})`);
      notify({ kind: "success", message: `已复制 (${key})` });
    } catch (cause) {
      notifyError(cause, "复制变量占位符失败");
    }
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!active) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        if (busyRef.current) return;
        if (pageMode === "text") {
          event.preventDefault();
          void saveTextMode();
        } else if (adding) {
          event.preventDefault();
          void saveNew();
        } else if (editing) {
          event.preventDefault();
          void saveEditing();
        }
      }
      if (event.key === "Escape") {
        if (deleteCandidate !== undefined) {
          event.preventDefault();
          setDeleteCandidate(undefined);
        } else if (adding || editing) {
          event.preventDefault();
          resetDraft();
        }
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if (!active || pageMode !== "structured" || (!event.metaKey && !event.ctrlKey) || event.key.toLocaleLowerCase() !== "f") return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", handleFind);
    return () => window.removeEventListener("keydown", handleFind);
  }, [active, pageMode]);

  const renderEditor = (mode: "add" | "edit") => {
    const isAdding = mode === "add";
    const normalizedKey = normalizeLocalVariableKey(draftKey);
    const businessLabel = localVariableLabel(normalizedKey);
    return <div className="local-variables-editor-shell">
      <div className="local-variables-editor-heading">
        <div>
          <div className="local-variables-kicker"><span className="local-variables-type edit">{isAdding ? "新增" : "编辑中"}</span>{businessLabel !== undefined && <span className="local-variables-label">{businessLabel}</span>}<span>变量{mode === "add" ? "新增" : "编辑"} · 工作区共享</span></div>
          <h3>{isAdding ? "新增变量" : "编辑变量"}</h3>
          <p>{isAdding ? "保存后立即用于所有代理实例" : "保存后立即同步到所有代理实例"}</p>
        </div>
        {dirty && <span className="local-variables-dirty"><i />未保存更改</span>}
      </div>
      <div className="local-variables-editor-body">
        <label className="local-variables-field">
          <span className="local-variables-field-heading">变量名 <span>保存时自动转为大写</span></span>
          <span className="local-variables-name-shell"><span className="local-variables-name-prefix">$</span><input ref={nameInputRef} value={draftKey} onChange={(event) => updateDraftKey(event.target.value)} placeholder={isAdding ? "例如 SOFTVERSION" : undefined} spellCheck={false} aria-label="变量名" /></span>
        </label>
        <label className="local-variables-field local-variables-value-field">
          <span className="local-variables-field-heading">变量值 <span>{draftValue.length.toLocaleString("zh-CN")} 字符 · 自动换行</span></span>
          <span className="local-variables-value-editor">
            <span className="local-variables-value-editor-heading"><span>纯文本</span><span>支持多行内容</span></span>
            <textarea ref={valueEditorRef} value={draftValue} onChange={(event) => updateDraftValue(event.target.value)} spellCheck={false} aria-label="变量值" />
          </span>
        </label>
        <div className="local-variables-reference-preview">
          <span>引用预览</span>
          <code>({normalizedKey || "KEY"})</code>
          <button type="button" className="local-variables-button" onClick={() => void copyPlaceholder(normalizedKey || "KEY")} disabled={busy || normalizedKey === ""}>复制</button>
        </div>
      </div>
      <div className="local-variables-editor-footer">
        {!isAdding && <button type="button" className="local-variables-delete-action" onClick={() => openDelete(selectedEntry!.key)} disabled={busy}>删除变量</button>}
        <span className="local-variables-shortcut-hint"><kbd>⌘S</kbd> 保存 <kbd>Esc</kbd> 取消</span>
        <button type="button" className="local-variables-button" onClick={resetDraft} onMouseDown={(event) => event.preventDefault()} disabled={busy}>取消</button>
        <button type="button" className="local-variables-button primary" onClick={() => void (isAdding ? saveNew() : saveEditing())} onMouseDown={(event) => event.preventDefault()} disabled={busy || !dirty}>{isAdding ? "添加并保存" : "保存更改"}</button>
      </div>
    </div>;
  };

  return <section className="panel local-variables-page">
    <div className="local-variables-heading">
      <div className="local-variables-heading-copy">
        <div className="local-variables-title-row">
          <h2>本地变量</h2>
          <span className={`local-cache-status ${statusTone}`} aria-live="polite"><i />{statusText}{loaded ? ` · ${stats.total} 项` : ""}</span>
        </div>
        <p>所有代理实例共用，可在转发地址、请求路径或请求体中使用 <code>($KEY)</code></p>
      </div>
      <div className="local-variables-heading-actions">
        {pageMode === "structured" ? <>
          <button type="button" className="local-variables-button primary" onClick={beginAdd} disabled={busy || !loaded}>＋ 新增变量</button>
          <button type="button" className="local-variables-button" onClick={() => void toggleMode()} onMouseDown={(event) => event.preventDefault()} disabled={busy || !loaded}>批量文本</button>
        </> : <>
          <button type="button" className="local-variables-button primary" onClick={() => void saveTextMode()} disabled={busy || !dirty}>保存文本</button>
          <button type="button" className="local-variables-button" onClick={() => void toggleMode()} onMouseDown={(event) => event.preventDefault()} disabled={busy}>结构化模式</button>
        </>}
      </div>
    </div>

    {pageMode === "structured" ? <>
      <div className="local-variables-toolbar">
        <label className="local-variables-search"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索变量名、业务标签或值" aria-label="搜索本地变量" /></label>
        <div className="local-variables-filters" aria-label="变量筛选">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {stats.total}</button>
          <button type="button" className={filter === "value" ? "active" : ""} onClick={() => setFilter("value")}>有值 {stats.nonEmpty}</button>
          <button type="button" className={filter === "empty" ? "active" : ""} onClick={() => setFilter("empty")}>空值 {stats.empty}</button>
          <button type="button" className={filter === "long" ? "active" : ""} onClick={() => setFilter("long")}>长文本 {stats.long}</button>
        </div>
        <div className="local-variables-toolbar-note"><strong>工作区共享</strong><i /><span>修改后立即用于所有代理</span></div>
      </div>

      <div className="local-variables-workspace">
        <section className="local-variables-list-panel" aria-label="变量列表">
          <div className="local-variables-list-heading"><div><h3>变量列表</h3><p>按名称排序</p></div><span>A–Z</span></div>
          <div className="local-variables-list-scroll" role="listbox" aria-label="本地变量">
            {entries.map((entry) => <button type="button" role="option" aria-selected={entry.key === selectedKey} className={`local-variables-row ${entry.key === selectedKey ? "selected" : ""}`} key={entry.key} onClick={() => selectEntry(entry)} title={`${entry.key}${entry.label === undefined ? "" : ` · ${entry.label}`}\n${entry.preview}`}>
              <span className="local-variables-key-copy"><span className="local-variables-key-line"><span className="local-variables-key">{entry.key}</span>{entry.label !== undefined && <span className="local-variables-label">{entry.label}</span>}<VariableTypeBadge entry={entry} /></span><span className="local-variables-key-preview">{entry.preview}</span></span>
              <span className="local-variables-row-meta"><span className="local-variables-char-count">{formatLocalCacheCharCount(entry.chars)}</span><span className="local-variables-chevron">›</span></span>
            </button>)}
            {entries.length === 0 && <div className="local-variables-list-empty">{!loaded ? "正在读取变量…" : stats.total === 0 ? "暂无本地变量" : "没有匹配的变量"}</div>}
          </div>
          <div className="local-variables-list-footer"><span><strong>{stats.total}</strong> 个变量</span><span>变量名不区分大小写</span></div>
        </section>

        <section className="local-variables-detail-panel" aria-label="变量详情">
          {adding ? renderEditor("add") : editing && selectedEntry !== undefined ? renderEditor("edit") : selectedEntry !== undefined ? <>
            <div className="local-variables-detail-heading">
              <div className="local-variables-detail-title"><div className="local-variables-kicker"><VariableTypeBadge entry={selectedEntry} />{selectedEntry.label !== undefined && <span className="local-variables-label">{selectedEntry.label}</span>}<span>变量详情 · 工作区共享</span></div><h3>{selectedEntry.key}</h3><div className="local-variables-detail-meta"><span>{selectedEntry.chars.toLocaleString("zh-CN")} 字符</span><i /><span>{selectedEntry.lines} 行</span><i /><span>保存时自动换行显示</span></div></div>
              <div className="local-variables-detail-actions">
                <button type="button" className="local-variables-button" onClick={() => void copyValue()} disabled={busy}><CopyIcon />复制值</button>
                <button type="button" className="local-variables-button primary" onClick={startEditing} disabled={busy}>编辑变量</button>
                <button type="button" className="local-variables-icon-button danger" title="删除变量" aria-label="删除变量" onClick={() => openDelete(selectedEntry.key)} disabled={busy}>×</button>
              </div>
            </div>
            <div className="local-variables-detail-body">
              <div className="local-variables-reference-card"><span className="local-variables-reference-symbol">( )</span><div><span>引用占位符</span><code>({selectedEntry.key})</code></div><button type="button" className="local-variables-button" onClick={() => void copyPlaceholder(selectedEntry.key)} disabled={busy}>复制占位符</button></div>
              <section className="local-variables-value-card" aria-label="变量值"><div className="local-variables-value-heading"><div><h3>变量值</h3><em>自动换行</em></div><button type="button" className="local-variables-icon-button" title="复制变量值" aria-label="复制变量值" onClick={() => void copyValue()} disabled={busy}><CopyIcon /></button></div><div className={`local-variables-code-view ${selectedEntry.chars === 0 ? "empty" : ""}`}>{selectedEntry.chars === 0 ? "空值" : selectedEntry.value}</div><div className="local-variables-value-footer"><span>UTF-8 · 纯文本</span><span>{selectedEntry.chars.toLocaleString("zh-CN")} 字符 · {selectedEntry.lines} 行</span></div></section>
              <div className="local-variables-usage-note"><i>i</i><p>可在转发地址、请求路径或请求体中使用 <code>({selectedEntry.key})</code>。引用变量名时不区分大小写。</p></div>
            </div>
          </> : <div className="local-variables-detail-empty"><strong>{!loaded ? "正在读取变量…" : stats.total === 0 ? "暂无本地变量" : "请选择一个变量"}</strong><span>{loaded && stats.total === 0 ? "点击“新增变量”创建第一项。" : "选择左侧变量查看内容。"}</span>{loaded && stats.total === 0 && <button type="button" className="local-variables-button primary" onClick={beginAdd}>＋ 新增变量</button>}</div>}
        </section>
      </div>
    </> : <div className="local-variables-text-panel">
      <div className="local-variables-text-heading"><div><h3>批量文本</h3><p>每行一个“变量名 = 值”；空行后的续行归入上一个值。</p></div><span>{stats.total} 项</span></div>
      <textarea className="local-variables-textarea" aria-label="本地变量批量文本" value={text} disabled={busy || !loaded} onChange={(event) => { setText(event.target.value); dirtyRef.current = true; setDirty(true); }} placeholder={"SOFTVERSION = 7.03.039\nMOBILECODE = 17000000000"} rows={18} spellCheck={false} />
      <div className="local-variables-text-footer"><span>变量名保存时自动转为大写</span><span>{text.split(/\r?\n/).filter((line) => line.trim() !== "").length} 行</span></div>
    </div>}

    {deleteCandidate !== undefined && <div className="local-variables-dialog-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteCandidate(undefined); }}>
      <div className="local-variables-dialog" role="dialog" aria-modal="true" aria-labelledby="local-variables-delete-title" aria-describedby="local-variables-delete-description">
        <div className="local-variables-dialog-heading"><div className="local-variables-dialog-icon" aria-hidden="true">!</div><div><h3 id="local-variables-delete-title">删除本地变量</h3><p>工作区共享 · 所有代理实例</p></div></div>
        <div className="local-variables-dialog-body"><p id="local-variables-delete-description">确定删除变量“{deleteCandidate}”吗？引用该变量的地址会保留占位符，但无法再替换为变量值。</p><div className="local-variables-dialog-summary"><span>将删除</span><strong>{deleteCandidate}</strong></div></div>
        <div className="local-variables-dialog-actions"><button ref={deleteCancelRef} type="button" className="local-variables-button" onClick={() => setDeleteCandidate(undefined)} disabled={busy}>取消</button><button type="button" className="local-variables-button danger-solid" onClick={() => void confirmDelete()} disabled={busy}>{busy ? "删除中…" : "删除变量"}</button></div>
      </div>
    </div>}
  </section>;
}
