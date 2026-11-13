import { useEffect, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, EncryptionPreferencesPatch, EncryptionProgress, EncryptionResult, ForwardingAddressHistory, LogEntry } from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import { formatLocalCacheText, parseLocalCacheText } from "../../shared/local-cache";
import { useToast } from "./ToastProvider";

export type Page = "runtime" | "local-cache" | "rules" | "addresses" | "request" | "string" | "local" | "values" | "cache" | "encryption" | "decryption" | "logs" | "appearance" | "json";
interface ConfigPagesProps {
  page: Page;
  config: AppConfig;
  logs: LogEntry[];
  onChange: (config: AppConfig) => Promise<boolean>;
  encryptionPreferences: EncryptionPreferences;
  onSelectEncryptionDirectory: (kind: EncryptionDirectoryKind) => Promise<string | undefined>;
  onSaveEncryptionPreferences: (patch: EncryptionPreferencesPatch) => Promise<boolean>;
  onEncryptDirectory: (inputDir: string, outputDir: string, mode: EncryptionMode) => Promise<EncryptionResult>;
  onEncryptionProgress: (listener: (progress: EncryptionProgress) => void) => () => void;
  loginCache: Record<string, string>;
  onSaveLoginCache: (values: Record<string, string>) => Promise<boolean>;
}
type EncryptionProgressViewPhase = EncryptionProgress["phase"] | "idle";
interface EncryptionProgressView {
  phase: EncryptionProgressViewPhase;
  current: number;
  total: number;
  processedFiles: number;
  skippedFiles: number;
}

function renderEncryptionLogLine(line: string, index: number) {
  if (line === "") return <span className="encryption-log-line encryption-log-line-blank" aria-hidden="true" key={index} />;
  const separator = line.indexOf("：");
  if (separator < 0) return <span className="encryption-log-line" key={index}><span className="encryption-log-muted">{line}</span></span>;
  const prefix = line.slice(0, separator + 1);
  const message = line.slice(separator + 1);
  return <span className="encryption-log-line" key={index}><span className="encryption-log-prefix">{prefix}</span><span className="encryption-log-message">{message}</span></span>;
}

export function formatEncryptionLocalTime(timestamp: number): string {
  const value = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

const addressLabels = ["hq", "jy", "zx"] as const;
const forwardingAddressPlaceholders = {
  hq: "60.12.9.58:7778",
  jy: "123.103.83.82:6064",
  zx: "123.103.83.82:6064",
} as const;

export function forwardingAddressPlaceholder(index: number): string | undefined {
  const key = addressLabels[index];
  return key === undefined ? undefined : forwardingAddressPlaceholders[key];
}

export interface AddressDraft { id: string; name: string; address: string; enabled: boolean; }

export function addressForTarget(target: AppConfig["tcpTargets"][number]): string {
  const protocol = target.transport === "http" ? target.protocol ?? "http" : "tcp";
  const host = target.host.includes(":") && !target.host.startsWith("[") ? `[${target.host}]` : target.host;
  return `${protocol}://${host}:${target.port}${target.basePath ?? ""}`;
}

export function appendForwardingAddressHistory(history: readonly string[] | undefined, address: string): string[] {
  const values = [address, ...(history ?? [])]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(values)].slice(0, 10);
}

export function forwardingAddressHistoryForTarget(history: AppConfig["forwardingAddressHistory"], key: keyof ForwardingAddressHistory): string[] {
  if (history === undefined || Array.isArray(history)) return [];
  return history[key] ?? [];
}

export function encryptionDirectoryHistoryForKind(preferences: EncryptionPreferences, kind: EncryptionDirectoryKind): string[] {
  return kind === "input" ? preferences.inputHistory : preferences.outputHistory;
}

export interface AddressParts { host: string; port: string; }

function defaultPort(protocol: string): string {
  return protocol === "https:" ? "443" : protocol === "http:" ? "80" : "";
}

export function addressPartsForDraft(address: string): AddressParts {
  const raw = address.trim();
  if (raw === "") return { host: "", port: "" };
  try {
    const parsed = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
    return { host: parsed.hostname.replace(/^\[|\]$/g, ""), port: parsed.port || defaultPort(parsed.protocol) };
  } catch {
    const authority = raw.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").split(/[/?#]/, 1)[0] ?? raw;
    const separator = authority.lastIndexOf(":");
    if (separator >= 0 && /^\d*$/.test(authority.slice(separator + 1))) {
      return { host: authority.slice(0, separator).replace(/^\[|\]$/g, ""), port: authority.slice(separator + 1) };
    }
    return { host: authority.replace(/^\[|\]$/g, ""), port: "" };
  }
}

export function addressFromParts(address: string, host: string, port: string): string {
  const trimmedHost = host.trim();
  const raw = address.trim();
  let parsed: URL | undefined;
  try {
    parsed = raw === "" ? undefined : new URL(raw.includes("://") ? raw : `tcp://${raw}`);
  } catch {
    parsed = undefined;
  }
  const protocol = raw.match(/^[a-z][a-z\d+.-]*:\/\//i)?.[0] ?? "";
  const basePath = parsed === undefined ? "" : normalizeTargetBasePath(parsed.pathname) ?? "";
  const displayHost = trimmedHost.includes(":") && !trimmedHost.startsWith("[") ? `[${trimmedHost}]` : trimmedHost;
  const displayPort = port.trim() === "" ? "" : `:${port.trim()}`;
  return `${protocol}${displayHost}${displayPort}${basePath}`;
}

function draftsForTargets(targets: AppConfig["tcpTargets"]): AddressDraft[] {
  return Array.from({ length: Math.max(3, targets.length) }, (_, index) => {
    const target = targets[index];
    return {
      id: target?.id ?? `tcp-${index + 1}`,
      name: target?.name ?? addressLabels[index] ?? `地址${index + 1}`,
      address: target === undefined ? "" : addressForTarget(target),
      enabled: target?.enabled ?? true,
    };
  });
}

export function normalizeTargetBasePath(pathname: string): string | undefined {
  const basePath = pathname.replace(/\/+$/, "");
  return basePath === "" ? undefined : basePath;
}

export function targetFromDraft(draft: AddressDraft, index: number): AppConfig["tcpTargets"][number] {
  const raw = draft.address.trim();
  const parsed = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
  if (parsed.protocol !== "tcp:" && parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${addressLabels[index] ?? "地址"} 地址协议不受支持`);
  if (!parsed.hostname) throw new Error(`${addressLabels[index] ?? "地址"} 地址缺少主机名`);
  const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : 0) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${addressLabels[index] ?? "地址"} 地址端口无效`);
  const basePath = normalizeTargetBasePath(parsed.pathname);
  return {
    id: draft.id,
    name: draft.name,
    host: parsed.hostname,
    port,
    ...(parsed.protocol === "http:" || parsed.protocol === "https:" ? { protocol: parsed.protocol.slice(0, -1) as "http" | "https" } : {}),
    ...(basePath === undefined ? {} : { basePath }),
    ...(parsed.protocol === "http:" || parsed.protocol === "https:" ? { transport: "http" as const } : {}),
    enabled: draft.enabled,
  };
}

export function ConfigPages({ page, config, logs, onChange, encryptionPreferences, onSelectEncryptionDirectory, onSaveEncryptionPreferences, onEncryptDirectory, onEncryptionProgress, loginCache, onSaveLoginCache }: ConfigPagesProps) {
  const { notifyError } = useToast();
  const [addressDrafts, setAddressDrafts] = useState(() => draftsForTargets(config.tcpTargets));
  const [openHistoryIndex, setOpenHistoryIndex] = useState<number>();
  const [openEncryptionHistoryKind, setOpenEncryptionHistoryKind] = useState<EncryptionDirectoryKind>();
  const [cacheText, setCacheText] = useState(() => formatLocalCacheText(loginCache));
  const [encryptionInputDir, setEncryptionInputDir] = useState(() => encryptionPreferences.inputDir);
  const [encryptionOutputDir, setEncryptionOutputDir] = useState(() => encryptionPreferences.outputDir);
  const [encryptionRunning, setEncryptionRunning] = useState(false);
  const [encryptionLogs, setEncryptionLogs] = useState<string[]>([]);
  const [encryptionProgress, setEncryptionProgress] = useState<EncryptionProgressView>({ phase: "idle", current: 0, total: 0, processedFiles: 0, skippedFiles: 0 });
  useEffect(() => { setAddressDrafts(draftsForTargets(config.tcpTargets)); }, [config.tcpTargets]);
  useEffect(() => { setCacheText(formatLocalCacheText(loginCache)); }, [loginCache]);
  useEffect(() => { setEncryptionInputDir(encryptionPreferences.inputDir); setEncryptionOutputDir(encryptionPreferences.outputDir); }, [encryptionPreferences]);
  useEffect(() => onEncryptionProgress((progress) => {
    setEncryptionProgress({
      phase: progress.phase,
      current: progress.phase === "scanning" ? 0 : progress.current,
      total: progress.total,
      processedFiles: progress.processedFiles,
      skippedFiles: progress.skippedFiles,
    });
    if (progress.phase === "scanning") {
      setEncryptionLogs((current) => [...current, "正在扫描文件…"].slice(-200));
      return;
    }
    if (progress.phase === "completed") {
      return;
    }
    if (progress.status === "encrypting" && progress.relativePath !== undefined) {
      setEncryptionLogs((current) => [...current, `加密：${progress.relativePath}`].slice(-200));
    }
  }), [onEncryptionProgress]);
  useEffect(() => {
    if (openHistoryIndex === undefined && openEncryptionHistoryKind === undefined) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".address-input-shell") !== null) {
        setOpenEncryptionHistoryKind(undefined);
        return;
      }
      const encryptionShell = target instanceof Element ? target.closest(".encryption-input-shell") : null;
      if (encryptionShell !== null) {
        setOpenHistoryIndex(undefined);
        const encryptionKind = encryptionShell.getAttribute("data-encryption-kind");
        if (encryptionKind !== openEncryptionHistoryKind) {
          setOpenEncryptionHistoryKind(undefined);
        }
        return;
      }
      setOpenHistoryIndex(undefined);
      setOpenEncryptionHistoryKind(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openHistoryIndex, openEncryptionHistoryKind]);

  const saveLoginCache = async () => {
    try {
      const pasted = parseLocalCacheText(cacheText);
      await onSaveLoginCache(pasted);
    } catch (error) {
      notifyError(error, "登录缓存格式无效");
    }
  };

  const saveAddressDrafts = async (drafts = addressDrafts) => {
    try {
      const firstEmpty = drafts.findIndex((draft) => draft.address.trim() === "");
      const laterFilled = firstEmpty >= 0 && drafts.slice(firstEmpty + 1).some((draft) => draft.address.trim() !== "");
      if (laterFilled) throw new Error("请按 hq、jy、zx 顺序填写地址");
      const tcpTargets = drafts.filter((draft) => draft.address.trim() !== "").map((draft, index) => targetFromDraft(draft, index));
      let forwardingAddressHistory: ForwardingAddressHistory = {
        hq: forwardingAddressHistoryForTarget(config.forwardingAddressHistory, "hq"),
        jy: forwardingAddressHistoryForTarget(config.forwardingAddressHistory, "jy"),
        zx: forwardingAddressHistoryForTarget(config.forwardingAddressHistory, "zx"),
      };
      for (const [index, target] of config.tcpTargets.entries()) {
        const historyKey = addressLabels[index];
        if (historyKey !== undefined) forwardingAddressHistory = { ...forwardingAddressHistory, [historyKey]: appendForwardingAddressHistory(forwardingAddressHistory[historyKey], addressForTarget(target)) };
      }
      for (const [index, draft] of drafts.filter((draft) => draft.address.trim() !== "").entries()) {
        const historyKey = addressLabels[index];
        if (historyKey !== undefined) forwardingAddressHistory = { ...forwardingAddressHistory, [historyKey]: appendForwardingAddressHistory(forwardingAddressHistory[historyKey], draft.address) };
      }
      await onChange({ ...config, tcpTargets, forwardingAddressHistory });
    } catch (error) {
      notifyError(error, "地址配置无效");
    }
  };

  const updateAddress = (index: number, value: string) => {
    setAddressDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, address: value } : draft));
  };

  const selectAddressHistory = (index: number, address: string) => {
    const nextDrafts = addressDrafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, address } : draft);
    setAddressDrafts(nextDrafts);
    setOpenHistoryIndex(undefined);
    void saveAddressDrafts(nextDrafts);
  };

  const addressHistoryForIndex = (index: number) => {
    const historyKey = addressLabels[index];
    return historyKey === undefined ? [] : forwardingAddressHistoryForTarget(config.forwardingAddressHistory, historyKey);
  };

  const chooseEncryptionDirectory = async (kind: EncryptionDirectoryKind) => {
    const selectedPath = await onSelectEncryptionDirectory(kind);
    if (selectedPath === undefined) return;
    if (kind === "input") setEncryptionInputDir(selectedPath);
    else setEncryptionOutputDir(selectedPath);
  };

  const saveEncryptionDirectory = async (kind: EncryptionDirectoryKind, value: string) => {
    try {
      const directory = parseDirectoryInput(value);
      const saved = await onSaveEncryptionPreferences(kind === "input" ? { inputDir: directory } : { outputDir: directory });
      if (!saved) {
        if (kind === "input") setEncryptionInputDir(encryptionPreferences.inputDir);
        else setEncryptionOutputDir(encryptionPreferences.outputDir);
        return;
      }
      if (kind === "input") setEncryptionInputDir(directory);
      else setEncryptionOutputDir(directory);
    } catch (error) {
      if (kind === "input") setEncryptionInputDir(encryptionPreferences.inputDir);
      else setEncryptionOutputDir(encryptionPreferences.outputDir);
      notifyError(error, "目录路径无效");
    }
  };

  const selectEncryptionHistory = (kind: EncryptionDirectoryKind, directory: string) => {
    setOpenEncryptionHistoryKind(undefined);
    void saveEncryptionDirectory(kind, directory);
  };

  const startEncryption = async (mode: EncryptionMode) => {
    if (!encryptionInputDir || !encryptionOutputDir) {
      notifyError("请先选择加密前和加密后文件夹目录", "加密目录不完整");
      return;
    }
    setEncryptionRunning(true);
    setOpenEncryptionHistoryKind(undefined);
    setEncryptionLogs(["开始执行加密任务…"]);
    setEncryptionProgress({ phase: "scanning", current: 0, total: 0, processedFiles: 0, skippedFiles: 0 });
    try {
      const result = await onEncryptDirectory(encryptionInputDir, encryptionOutputDir, mode);
      if (!result.ok) {
        setEncryptionProgress((current) => ({ ...current, phase: "idle" }));
        return;
      }
      const total = result.totalFiles ?? 0;
      const processed = result.processedFiles ?? total;
      const skipped = result.skippedFiles ?? 0;
      const removed = result.removedFiles ?? 0;
      setEncryptionProgress({ phase: "completed", current: total, total, processedFiles: processed, skippedFiles: skipped });
      const completedAt = formatEncryptionLocalTime(Date.now());
      setEncryptionLogs((current) => [...current, "", `完成：处理 ${processed} 个，跳过 ${skipped} 个，删除 ${removed} 个（共 ${total} 个） ${completedAt}`].slice(-200));
    } catch (error) {
      setEncryptionProgress((current) => ({ ...current, phase: "idle" }));
      notifyError(error, "加密失败");
    } finally {
      setEncryptionRunning(false);
    }
  };

  const encryptionProgressPercent = encryptionProgress.total === 0
    ? 0
    : Math.min(100, Math.round((encryptionProgress.current / encryptionProgress.total) * 100));
  const encryptionStatusLabel = encryptionProgress.phase === "completed"
    ? "加密完成"
    : encryptionRunning
      ? "正在处理"
      : "等待开始";
  const encryptionStatusTone = encryptionProgress.phase === "completed" ? "completed" : encryptionRunning ? "running" : "idle";
  const encryptionRemainingCount = Math.max(0, encryptionProgress.total - encryptionProgress.current);
  const encryptionLogStatus = encryptionRunning ? "处理中" : encryptionProgress.phase === "completed" ? "已完成" : "待命";

  const renderEncryptionDirectoryField = (kind: EncryptionDirectoryKind, label: string, chooseLabel: string, context: string, directory: string, setDirectory: (value: string) => void) => {
    const history = encryptionDirectoryHistoryForKind(encryptionPreferences, kind);
    const inputId = `encryption-${kind}-directory`;
    return <div className="encryption-directory-field">
      <div className="encryption-directory-label"><label htmlFor={inputId}>{label}</label><span>{context}</span></div>
      <div className="input-with-button">
        <div className="encryption-input-shell" data-encryption-kind={kind}>
          <input id={inputId} className="encryption-directory-input" disabled={encryptionRunning} value={directory} placeholder="粘贴 file:/// URL 或本地目录路径" onChange={(event) => setDirectory(event.target.value)} onBlur={() => void saveEncryptionDirectory(kind, directory)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveEncryptionDirectory(kind, directory); } }} />
          <button type="button" className="address-history-toggle encryption-history-toggle" aria-label={kind === "input" ? "显示加密前目录历史" : "显示加密后目录历史"} aria-expanded={openEncryptionHistoryKind === kind} disabled={encryptionRunning || history.length === 0} onClick={() => setOpenEncryptionHistoryKind((current) => current === kind ? undefined : kind)}><span className="address-history-chevron encryption-history-chevron" aria-hidden="true" /></button>
          {openEncryptionHistoryKind === kind && <div className="address-history-menu encryption-history-menu" role="listbox" aria-label={kind === "input" ? "加密前目录历史" : "加密后目录历史"}>{history.map((directory) => <button type="button" role="option" aria-selected={directory === (kind === "input" ? encryptionInputDir : encryptionOutputDir)} className="address-history-option encryption-history-option" disabled={encryptionRunning} key={directory} onMouseDown={(event) => event.preventDefault()} onClick={() => selectEncryptionHistory(kind, directory)}>{directory}</button>)}</div>}
        </div>
        <button type="button" className="encryption-browse-button" disabled={encryptionRunning} onClick={() => void chooseEncryptionDirectory(kind)}>{chooseLabel}</button>
      </div>
    </div>;
  };

  if (page === "addresses") return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">/reqxml</p><h2>转发地址</h2></div></div>{addressDrafts.map((draft, index) => <div className="address-editor" key={draft.id}><label className="address-field"><span>{addressLabels[index] ?? `地址${index + 1}`} 地址</span><div className="address-input-shell"><input className="address-input" value={draft.address} placeholder={forwardingAddressPlaceholder(index)} onChange={(event) => updateAddress(index, event.target.value)} onBlur={() => void saveAddressDrafts()} /><button type="button" className="address-history-toggle" aria-label="显示历史地址" aria-expanded={openHistoryIndex === index} disabled={addressHistoryForIndex(index).length === 0} onClick={() => setOpenHistoryIndex((current) => current === index ? undefined : index)}><span className="address-history-chevron" aria-hidden="true" /></button>{openHistoryIndex === index && <div className="address-history-menu" role="listbox" aria-label="历史地址">{addressHistoryForIndex(index).map((address) => <button type="button" role="option" aria-selected={draft.address === address} className="address-history-option" key={address} onMouseDown={(event) => event.preventDefault()} onClick={() => selectAddressHistory(index, address)}>{address}</button>)}</div>}</div></label></div>)}</section>;
  if (page === "values") return <section className="panel config-textarea-panel">
    <p className="muted config-textarea-hint">当前代理已缓存 {Object.keys(loginCache).length} 项，登录请求成功后会自动更新。</p>
    <textarea className="config-textarea login-cache-input" aria-label="登录缓存" value={cacheText} onChange={(event) => setCacheText(event.target.value)} onBlur={() => void saveLoginCache()} placeholder="Token = xxx\nSessionNo = 123" rows={14} />
  </section>;
  if (page === "cache") return <section className="panel"><p className="eyebrow">资源管理</p><h2>缓存</h2><dl className="settings-list"><div><dt>根目录</dt><dd>{config.cache.rootDir || "默认应用缓存"}</dd></div><div><dt>下载目标</dt><dd>{config.cache.downloadTarget || "未配置"}</dd></div><div><dt>解密 .d 资源</dt><dd>{config.cache.decryptEnabled ? "已启用" : "已停用"}</dd></div></dl></section>;
  if (page === "encryption") return <section className="panel encryption-panel encryption-page">
    <header className="encryption-heading">
      <div><p className="eyebrow">/encrypt</p><h2>加密 .d 资源</h2><p>将项目文件递归编码为可发布的 .d 资源，并记录 SHA-256 清单用于后续增量加密。</p></div>
      <span className="encryption-local-badge"><i aria-hidden="true" />本地处理</span>
    </header>

    <div className="encryption-format-grid">
      <article><span className="encryption-format-icon">JS</span><div><strong>脚本资源</strong><p>.js / .html / .htm / .css 执行 gzip、RC4 与 CRC32 编码。</p></div></article>
      <article><span className="encryption-format-icon binary">01</span><div><strong>其他资源</strong><p>图片、字体、WASM、PDF 等追加 CRC32 后原样输出。</p></div></article>
      <article><span className="encryption-format-icon manifest">Δ</span><div><strong>增量清单</strong><p>记录源文件 SHA-256，下次仅处理发生变化的文件。</p></div></article>
    </div>

    <div className="encryption-directory-list">
      {renderEncryptionDirectoryField("input", "加密前文件夹目录", "选择加密前目录", encryptionProgress.total > 0 ? `检测到 ${encryptionProgress.total} 个待编码文件` : "递归扫描可编码文件", encryptionInputDir, setEncryptionInputDir)}
      {renderEncryptionDirectoryField("output", "加密后文件夹目录", "选择加密后目录", ".d 后缀 · 保留原始目录结构", encryptionOutputDir, setEncryptionOutputDir)}
    </div>

    <div className={`encryption-progress-card ${encryptionStatusTone}`} aria-live="polite">
      <div className="encryption-progress-heading">
        <div><span className="encryption-progress-kicker">加密进度</span><strong>{encryptionStatusLabel}</strong></div>
        <b>{encryptionProgressPercent}%</b>
      </div>
      <div className="encryption-progress-bar" role="progressbar" aria-label="加密进度" aria-valuemin={0} aria-valuemax={encryptionProgress.total} aria-valuenow={encryptionProgress.current}><span style={{ width: `${encryptionProgressPercent}%` }} /></div>
      <div className="encryption-stat-grid">
        <div><span>总文件</span><strong>{encryptionProgress.total}</strong></div>
        <div><span>已加密</span><strong className="success">{encryptionProgress.processedFiles}</strong></div>
        <div><span>已跳过</span><strong>{encryptionProgress.skippedFiles}</strong></div>
        <div><span>待处理</span><strong>{encryptionRemainingCount}</strong></div>
      </div>
    </div>

    <div className="encryption-actions">
      <button type="button" className="primary" aria-busy={encryptionRunning} disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption("full")}>{encryptionRunning && <span className="encryption-spinner" aria-hidden="true" />}{encryptionRunning ? "正在加密…" : "开始加密"}</button>
      <button type="button" className="encryption-incremental-button" disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption("incremental")}>增量加密</button>
      <p>增量模式会跳过未变化的文件</p>
    </div>
    <p className="encryption-footnote">加密时自动跳过隐藏文件、node_modules 和 .map；输出目录中的同名 .d 文件会被覆盖。</p>

    <div className="encryption-log-shell">
      <div className="encryption-log-heading"><strong>实时日志</strong><span><i aria-hidden="true" />{encryptionLogStatus}{encryptionLogs.length > 0 ? ` · ${encryptionLogs.length} 条` : ""}</span></div>
      {encryptionLogs.length > 0
        ? <div className="encryption-log-view" role="log" aria-live="polite">{encryptionLogs.map(renderEncryptionLogLine)}</div>
        : <div className="encryption-log-empty">开始加密后，处理日志会显示在这里。</div>}
    </div>
  </section>;
  if (page === "logs") return <section className="panel"><p className="eyebrow">运行记录</p><h2>{logs.length} 条日志</h2><p className="muted">可在日志页面查看近期服务活动。</p></section>;
  return null;
}
