import { useEffect, useState } from "react";
import type {
  DecryptionDirectoryKind,
  DecryptionPreferences,
  DecryptionPreferencesPatch,
  DecryptionProgress,
  DecryptionResult,
} from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import { useToast } from "./ToastProvider";

const initialPreferences: DecryptionPreferences = { inputDir: "", outputDir: "", inputHistory: [], outputHistory: [] };
const initialProgress: DecryptionProgress = { phase: "scanning", current: 0, total: 0, processedFiles: 0, failedFiles: 0 };
const directoryLabels = {
  input: { label: "待解密文件夹目录", placeholder: "选择包含 .d 文件的文件夹", action: "选择解密目录" },
  output: { label: "解密后文件夹目录", placeholder: "选择原文件还原到的文件夹", action: "选择输出目录" },
} as const;

function formatDecryptionTime(timestamp: number): string {
  const value = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function historyFor(preferences: DecryptionPreferences, kind: DecryptionDirectoryKind): string[] {
  return kind === "input" ? preferences.inputHistory : preferences.outputHistory;
}

export function DecryptionPage() {
  const { notify, notifyError } = useToast();
  const [preferences, setPreferences] = useState<DecryptionPreferences>(initialPreferences);
  const [inputDir, setInputDir] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [openHistoryKind, setOpenHistoryKind] = useState<DecryptionDirectoryKind>();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<DecryptionProgress>(initialProgress);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<DecryptionResult>();

  useEffect(() => {
    let active = true;
    void window.forwarder.getDecryptionPreferences().then((next) => {
      if (!active) return;
      setPreferences(next);
      setInputDir(next.inputDir);
      setOutputDir(next.outputDir);
    }).catch((error) => {
      if (active) notifyError(error, "解密目录配置读取失败");
    });
    return () => { active = false; };
  }, [notifyError]);

  useEffect(() => window.forwarder.onDecryptionProgress((next) => {
    setProgress(next);
    if (next.phase === "scanning") {
      setLogs((current) => [...current, "正在扫描 .d 文件…"].slice(-250));
    } else if (next.status === "decrypting" && next.relativePath !== undefined) {
      setLogs((current) => [...current, `解密：${next.relativePath}`].slice(-250));
    } else if (next.status === "failed" && next.relativePath !== undefined) {
      setLogs((current) => [...current, `失败：${next.relativePath}`].slice(-250));
    }
  }), []);

  useEffect(() => {
    if (openHistoryKind === undefined) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".decryption-input-shell") !== null) return;
      setOpenHistoryKind(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openHistoryKind]);

  const replacePreferences = (next: DecryptionPreferences): void => {
    setPreferences(next);
    setInputDir(next.inputDir);
    setOutputDir(next.outputDir);
  };

  const saveDirectory = async (kind: DecryptionDirectoryKind, value: string): Promise<void> => {
    try {
      const directory = parseDirectoryInput(value);
      const patch: DecryptionPreferencesPatch = kind === "input" ? { inputDir: directory } : { outputDir: directory };
      const saved = await window.forwarder.saveDecryptionPreferences(patch);
      if (!saved.ok) throw new Error(saved.error ?? "解密目录保存失败");
      replacePreferences(saved.preferences ?? { ...preferences, ...patch });
      setOpenHistoryKind(undefined);
    } catch (error) {
      if (kind === "input") setInputDir(preferences.inputDir);
      else setOutputDir(preferences.outputDir);
      notifyError(error, "目录路径无效");
    }
  };

  const chooseDirectory = async (kind: DecryptionDirectoryKind): Promise<void> => {
    try {
      const selected = await window.forwarder.selectDecryptionDirectory(kind);
      if (selected.canceled) return;
      if (!selected.ok || selected.path === undefined) throw new Error(selected.error ?? "选择目录失败");
      if (selected.preferences === undefined) {
        if (kind === "input") setInputDir(selected.path);
        else setOutputDir(selected.path);
      } else {
        replacePreferences(selected.preferences);
      }
    } catch (error) {
      notifyError(error, "选择目录失败");
    }
  };

  const startDecryption = async (): Promise<void> => {
    if (!inputDir || !outputDir) {
      notify({ kind: "warning", message: "请先选择解密目录和输出目录" });
      return;
    }
    setRunning(true);
    setResult(undefined);
    setLogs(["开始执行解密任务…"]);
    setProgress({ phase: "scanning", current: 0, total: 0, processedFiles: 0, failedFiles: 0 });
    try {
      const next = await window.forwarder.decryptDirectory(inputDir, outputDir);
      if (!next.ok) {
        setProgress((current) => ({ ...current, phase: "scanning", current: 0, total: 0 }));
        notifyError(next.error ?? "解密失败", "解密失败");
        return;
      }
      setResult(next);
      setLogs((next.logs ?? []).concat(`完成：还原 ${next.processedFiles ?? 0} 个，失败 ${next.failedFiles ?? 0} 个，跳过 ${next.skippedFiles ?? 0} 个（共 ${next.totalFiles ?? 0} 个） ${formatDecryptionTime(Date.now())}`).slice(-250));
      setProgress({ phase: "completed", status: "completed", current: next.totalFiles ?? 0, total: next.totalFiles ?? 0, processedFiles: next.processedFiles ?? 0, failedFiles: next.failedFiles ?? 0 });
      if ((next.failedFiles ?? 0) > 0) {
        notify({ kind: "warning", title: "部分文件未还原", message: `成功 ${next.processedFiles ?? 0} 个，失败 ${next.failedFiles ?? 0} 个，请查看失败列表。` });
      } else {
        notify({ kind: "success", message: `已还原 ${next.processedFiles ?? 0} 个文件${(next.hashVerifiedFiles ?? 0) > 0 ? `，${next.hashVerifiedFiles} 个通过 SHA-256 校验` : ""}` });
      }
    } catch (error) {
      setProgress((current) => ({ ...current, phase: "scanning", current: 0, total: 0 }));
      notifyError(error, "解密失败");
    } finally {
      setRunning(false);
    }
  };

  const percent = progress.total === 0 ? 0 : Math.min(100, Math.round((progress.current / progress.total) * 100));
  const statusLabel = progress.phase === "completed" ? "解密完成" : running ? "正在处理" : "等待开始";
  const statusTone = progress.phase === "completed" ? "completed" : running ? "running" : "idle";
  const completedCount = progress.processedFiles + progress.failedFiles;
  const remainingCount = Math.max(0, progress.total - completedCount);

  const renderDirectoryField = (kind: DecryptionDirectoryKind) => {
    const value = kind === "input" ? inputDir : outputDir;
    const setValue = kind === "input" ? setInputDir : setOutputDir;
    const copy = directoryLabels[kind];
    const history = historyFor(preferences, kind);
    const historyOpen = openHistoryKind === kind;
    return <div className="decryption-directory-field">
      <div className="decryption-directory-label"><label htmlFor={`decryption-${kind}-directory`}>{copy.label}</label><span>{kind === "input" ? "递归读取 .d 文件" : "同目录结构还原"}</span></div>
      <div className="input-with-button">
        <div className="decryption-input-shell" data-decryption-kind={kind}>
          <input id={`decryption-${kind}-directory`} className="decryption-directory-input" value={value} placeholder={copy.placeholder} disabled={running} onChange={(event) => setValue(event.target.value)} onBlur={() => { if (value !== (kind === "input" ? preferences.inputDir : preferences.outputDir)) void saveDirectory(kind, value); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveDirectory(kind, value); } }} />
          <button type="button" className="address-history-toggle decryption-history-toggle" aria-label={`显示${copy.label}历史`} aria-expanded={historyOpen} disabled={running || history.length === 0} onClick={() => setOpenHistoryKind((current) => current === kind ? undefined : kind)}><span className="address-history-chevron" aria-hidden="true" /></button>
          {historyOpen && <div className="address-history-menu decryption-history-menu" role="listbox" aria-label={`${copy.label}历史`}>
            {history.map((directory) => <button type="button" role="option" aria-selected={directory === value} className="address-history-option decryption-history-option" disabled={running} key={directory} onMouseDown={(event) => event.preventDefault()} onClick={() => { setValue(directory); void saveDirectory(kind, directory); }}>{directory}</button>)}
          </div>}
        </div>
        <button type="button" className="decryption-browse-button" disabled={running} onClick={() => void chooseDirectory(kind)}>{copy.action}</button>
      </div>
    </div>;
  };

  return <section className="panel decryption-page">
    <header className="decryption-heading">
      <div><p className="eyebrow">/decrypt</p><h2>解密 .d 资源</h2><p>将加密后的文件夹还原为原始目录结构和文件内容，并在写入前完成完整性校验。</p></div>
      <span className="decryption-local-badge"><i aria-hidden="true" />本地处理</span>
    </header>

    <div className="decryption-format-grid">
      <article><span className="decryption-format-icon">JS</span><div><strong>脚本资源</strong><p>.js / .html / .htm / .css 自动执行 RC4 解密与 gzip 解压。</p></div></article>
      <article><span className="decryption-format-icon binary">01</span><div><strong>其他资源</strong><p>图片、字体、WASM、PDF 等按原始字节完整还原。</p></div></article>
      <article><span className="decryption-format-icon verify">✓</span><div><strong>双重校验</strong><p>始终校验 CRC32；存在加密清单时额外比对 SHA-256。</p></div></article>
    </div>

    <div className="decryption-directory-list">{renderDirectoryField("input")}{renderDirectoryField("output")}</div>

    <div className={`decryption-progress-card ${statusTone}`} aria-live="polite">
      <div className="decryption-progress-heading">
        <div><span className="decryption-progress-kicker">解密进度</span><strong>{statusLabel}</strong></div>
        <b>{percent}%</b>
      </div>
      <div className="decryption-progress-bar" role="progressbar" aria-label="解密进度" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.current}><span style={{ width: `${percent}%` }} /></div>
      <div className="decryption-stat-grid">
        <div><span>总文件</span><strong>{progress.total}</strong></div>
        <div><span>已还原</span><strong className="success">{progress.processedFiles}</strong></div>
        <div><span>失败</span><strong className={progress.failedFiles > 0 ? "danger" : ""}>{progress.failedFiles}</strong></div>
        <div><span>待处理</span><strong>{remainingCount}</strong></div>
      </div>
    </div>

    <div className="decryption-actions">
      <button type="button" className="decryption-run-button" disabled={running || !inputDir || !outputDir} onClick={() => void startDecryption()}>{running ? "正在解密…" : "开始解密"}</button>
      <p>输出目录中已存在的同名文件会被直接替换。</p>
    </div>
    <p className="decryption-footnote">加密时排除的隐藏文件、node_modules、.map 和空目录不在 .d 目录中，无法还原；文件修改时间与权限也不会保留。</p>

    {logs.length > 0 && <pre className="decryption-log">{logs.join("\n")}</pre>}

    {(result?.failures?.length ?? 0) > 0 && <section className="decryption-failures">
      <div className="decryption-failures-heading"><div><span>需要处理</span><h3>{result?.failedFiles} 个文件未还原</h3></div><span className="decryption-failure-count">{result?.failures?.length}</span></div>
      <div className="decryption-failure-list">
        {result?.failures?.map((failure) => <div className="decryption-failure-row" key={failure.relativePath}><code>{failure.relativePath}</code><p>{failure.error}</p></div>)}
      </div>
    </section>}
  </section>;
}
