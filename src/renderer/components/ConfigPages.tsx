import { useEffect, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, EncryptionPreferencesPatch, EncryptionProgress, EncryptionResult, ForwardingAddressHistory, LogEntry, ManualRequestConfig, ManualRequestResponse } from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import { formatLocalCacheText, parseLocalCacheText } from "../../shared/local-cache";
import { DismissibleError } from "./DismissibleError";
import { RequestPage } from "./RequestPage";
import { StringToolPage } from "./StringToolPage";

export type Page = "runtime" | "rules" | "addresses" | "request" | "string" | "local" | "values" | "cache" | "encryption" | "logs" | "appearance" | "json";
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
  onSendRequest: (request: ManualRequestConfig) => Promise<ManualRequestResponse>;
  sharedValues: Record<string, string>;
  loginCache: Record<string, string>;
  onSaveSharedValues: (values: Record<string, string>) => Promise<boolean>;
  onSaveLoginCache: (values: Record<string, string>) => Promise<boolean>;
}
const addressLabels = ["hq", "jy", "zx"] as const;

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

export function ConfigPages({ page, config, logs, onChange, encryptionPreferences, onSelectEncryptionDirectory, onSaveEncryptionPreferences, onEncryptDirectory, onEncryptionProgress, onSendRequest, sharedValues, loginCache, onSaveSharedValues, onSaveLoginCache }: ConfigPagesProps) {
  const [addressDrafts, setAddressDrafts] = useState(() => draftsForTargets(config.tcpTargets));
  const [addressError, setAddressError] = useState("");
  const [openHistoryIndex, setOpenHistoryIndex] = useState<number>();
  const [openEncryptionHistoryKind, setOpenEncryptionHistoryKind] = useState<EncryptionDirectoryKind>();
  const [localText, setLocalText] = useState(() => formatLocalCacheText(sharedValues));
  const [localError, setLocalError] = useState("");
  const [cacheText, setCacheText] = useState(() => formatLocalCacheText(loginCache));
  const [cacheError, setCacheError] = useState("");
  const [encryptionInputDir, setEncryptionInputDir] = useState(() => encryptionPreferences.inputDir);
  const [encryptionOutputDir, setEncryptionOutputDir] = useState(() => encryptionPreferences.outputDir);
  const [encryptionRunning, setEncryptionRunning] = useState(false);
  const [encryptionError, setEncryptionError] = useState("");
  const [encryptionLogs, setEncryptionLogs] = useState<string[]>([]);
  const [encryptionProgress, setEncryptionProgress] = useState({ current: 0, total: 0, processedFiles: 0 });
  useEffect(() => { setAddressDrafts(draftsForTargets(config.tcpTargets)); }, [config.tcpTargets]);
  useEffect(() => { setLocalText(formatLocalCacheText(sharedValues)); }, [sharedValues]);
  useEffect(() => { setCacheText(formatLocalCacheText(loginCache)); }, [loginCache]);
  useEffect(() => { setEncryptionInputDir(encryptionPreferences.inputDir); setEncryptionOutputDir(encryptionPreferences.outputDir); }, [encryptionPreferences]);
  useEffect(() => onEncryptionProgress((progress) => {
    setEncryptionProgress({
      current: progress.phase === "scanning" ? 0 : progress.current,
      total: progress.total,
      processedFiles: progress.processedFiles,
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
      if (target instanceof Element && target.closest(".encryption-input-shell") !== null) {
        setOpenHistoryIndex(undefined);
        return;
      }
      setOpenHistoryIndex(undefined);
      setOpenEncryptionHistoryKind(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openHistoryIndex, openEncryptionHistoryKind]);

  const saveLocalValues = async () => {
    try {
      const parsed = parseLocalCacheText(localText);
      if (Object.keys(parsed).length === 0) {
        const saved = await onSaveSharedValues({});
        setLocalError(saved ? "" : "配置未保存，请先停止服务");
        return;
      }
      const saved = await onSaveSharedValues(parsed);
      if (saved) {
        setLocalError("");
      } else {
        setLocalError("配置未保存，请先停止服务");
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "本地变量格式无效");
    }
  };

  const saveLoginCache = async () => {
    try {
      const pasted = parseLocalCacheText(cacheText);
      const saved = await onSaveLoginCache(pasted);
      setCacheError(saved ? "" : "配置未保存，请先停止服务");
    } catch (error) {
      setCacheError(error instanceof Error ? error.message : "登录缓存格式无效");
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
      const saved = await onChange({ ...config, tcpTargets, forwardingAddressHistory });
      setAddressError(saved ? "" : "配置未保存，请先停止服务");
    } catch (error) {
      setAddressError(error instanceof Error ? error.message : "地址配置无效");
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
    setEncryptionError("");
    const selectedPath = await onSelectEncryptionDirectory(kind);
    if (selectedPath === undefined) return;
    if (kind === "input") setEncryptionInputDir(selectedPath);
    else setEncryptionOutputDir(selectedPath);
  };

  const saveEncryptionDirectory = async (kind: EncryptionDirectoryKind, value: string) => {
    try {
      const directory = parseDirectoryInput(value);
      const saved = await onSaveEncryptionPreferences(kind === "input" ? { inputDir: directory } : { outputDir: directory });
      if (!saved) throw new Error("配置未保存，请先停止服务");
      if (kind === "input") setEncryptionInputDir(directory);
      else setEncryptionOutputDir(directory);
      setEncryptionError("");
    } catch (error) {
      if (kind === "input") setEncryptionInputDir(encryptionPreferences.inputDir);
      else setEncryptionOutputDir(encryptionPreferences.outputDir);
      setEncryptionError(error instanceof Error ? error.message : "目录路径无效");
    }
  };

  const selectEncryptionHistory = (kind: EncryptionDirectoryKind, directory: string) => {
    setOpenEncryptionHistoryKind(undefined);
    void saveEncryptionDirectory(kind, directory);
  };

  const startEncryption = async (mode: EncryptionMode) => {
    if (!encryptionInputDir || !encryptionOutputDir) {
      setEncryptionError("请先选择加密前和加密后文件夹目录");
      return;
    }
    setEncryptionRunning(true);
    setOpenEncryptionHistoryKind(undefined);
    setEncryptionError("");
    setEncryptionLogs(["开始执行加密任务…"]);
    setEncryptionProgress({ current: 0, total: 0, processedFiles: 0 });
    try {
      const result = await onEncryptDirectory(encryptionInputDir, encryptionOutputDir, mode);
      if (!result.ok) {
        setEncryptionError(result.error ?? "加密失败");
        setEncryptionLogs((current) => [...current, `失败：${result.error ?? "加密失败"}`].slice(-200));
        return;
      }
      const total = result.totalFiles ?? 0;
      const processed = result.processedFiles ?? total;
      const skipped = result.skippedFiles ?? 0;
      const removed = result.removedFiles ?? 0;
      setEncryptionProgress({ current: total, total, processedFiles: processed });
      setEncryptionLogs((current) => [...current, "", `完成：处理 ${processed} 个，跳过 ${skipped} 个，删除 ${removed} 个（共 ${total} 个）`].slice(-200));
    } catch (error) {
      const message = error instanceof Error ? error.message : "加密失败";
      setEncryptionError(message);
      setEncryptionLogs((current) => [...current, `失败：${message}`].slice(-200));
    } finally {
      setEncryptionRunning(false);
    }
  };

  const encryptionProgressPercent = encryptionProgress.total === 0
    ? 0
    : Math.min(100, Math.round((encryptionProgress.current / encryptionProgress.total) * 100));

  const renderEncryptionDirectoryField = (kind: EncryptionDirectoryKind, label: string, chooseLabel: string, directory: string, setDirectory: (value: string) => void) => {
    const history = encryptionDirectoryHistoryForKind(encryptionPreferences, kind);
    return <label className="encryption-directory-field">{label}<div className="input-with-button"><div className="encryption-input-shell"><input className="encryption-directory-input" disabled={encryptionRunning} value={directory} placeholder="粘贴 file:/// URL 或本地目录路径" onChange={(event) => setDirectory(event.target.value)} onBlur={() => void saveEncryptionDirectory(kind, directory)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveEncryptionDirectory(kind, directory); } }} /><button type="button" className="address-history-toggle encryption-history-toggle" aria-label={kind === "input" ? "显示加密前目录历史" : "显示加密后目录历史"} aria-expanded={openEncryptionHistoryKind === kind} disabled={encryptionRunning || history.length === 0} onClick={() => setOpenEncryptionHistoryKind((current) => current === kind ? undefined : kind)}><span className="address-history-chevron encryption-history-chevron" aria-hidden="true" /></button>{openEncryptionHistoryKind === kind && <div className="address-history-menu encryption-history-menu" role="listbox" aria-label={kind === "input" ? "加密前目录历史" : "加密后目录历史"}>{history.map((directory) => <button type="button" role="option" aria-selected={directory === (kind === "input" ? encryptionInputDir : encryptionOutputDir)} className="address-history-option encryption-history-option" disabled={encryptionRunning} key={directory} onMouseDown={(event) => event.preventDefault()} onClick={() => selectEncryptionHistory(kind, directory)}>{directory}</button>)}</div>}</div><button type="button" disabled={encryptionRunning} onClick={() => void chooseEncryptionDirectory(kind)}>{chooseLabel}</button></div></label>;
  };

  if (page === "addresses") return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">/reqxml</p><h2>转发地址</h2></div></div>{addressDrafts.map((draft, index) => <div className="address-editor" key={draft.id}><label className="address-field"><span>{addressLabels[index] ?? `地址${index + 1}`} 地址</span><div className="address-input-shell"><input className="address-input" value={draft.address} placeholder="例如 https://h5khtest.citics.com/ant" onChange={(event) => updateAddress(index, event.target.value)} onBlur={() => void saveAddressDrafts()} /><button type="button" className="address-history-toggle" aria-label="显示历史地址" aria-expanded={openHistoryIndex === index} disabled={addressHistoryForIndex(index).length === 0} onClick={() => setOpenHistoryIndex((current) => current === index ? undefined : index)}><span className="address-history-chevron" aria-hidden="true" /></button>{openHistoryIndex === index && <div className="address-history-menu" role="listbox" aria-label="历史地址">{addressHistoryForIndex(index).map((address) => <button type="button" role="option" aria-selected={draft.address === address} className="address-history-option" key={address} onMouseDown={(event) => event.preventDefault()} onClick={() => selectAddressHistory(index, address)}>{address}</button>)}</div>}</div></label><label className="address-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setAddressDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />启用</label></div>)}{addressError && <DismissibleError message={addressError} onClose={() => setAddressError("")} />}</section>;
  if (page === "request") return <RequestPage config={config} onChange={onChange} onSendRequest={onSendRequest} />;
  if (page === "string") return <StringToolPage config={config} />;
  if (page === "local") return <section className="panel"><p className="muted">可直接输入本地变量，按“键 = 值”逐行填写，离开输入框后自动保存。</p><textarea className="local-values-input" aria-label="本地变量输入" value={localText} onChange={(event) => setLocalText(event.target.value)} onBlur={() => void saveLocalValues()} placeholder="localKey = value\nAnotherKey = another value" rows={18} />{localError && <DismissibleError message={localError} onClose={() => setLocalError("")} />}</section>;
  if (page === "values") return <section className="panel"><textarea className="login-cache-input" aria-label="登录缓存" value={cacheText} onChange={(event) => setCacheText(event.target.value)} onBlur={() => void saveLoginCache()} placeholder="Token = xxx\nSessionNo = 123" rows={14} />{cacheError && <DismissibleError message={cacheError} onClose={() => setCacheError("")} />}<p className="muted">当前代理已缓存 {Object.keys(loginCache).length} 项，登录请求成功后会自动更新。</p></section>;
  if (page === "cache") return <section className="panel"><p className="eyebrow">资源管理</p><h2>缓存</h2><dl className="settings-list"><div><dt>根目录</dt><dd>{config.cache.rootDir || "默认应用缓存"}</dd></div><div><dt>下载目标</dt><dd>{config.cache.downloadTarget || "未配置"}</dd></div><div><dt>解密 .d 资源</dt><dd>{config.cache.decryptEnabled ? "已启用" : "已停用"}</dd></div></dl></section>;
  if (page === "encryption") return <section className="panel encryption-panel"><div className="encryption-directory-list">{renderEncryptionDirectoryField("input", "加密前文件夹目录", "选择加密前目录", encryptionInputDir, setEncryptionInputDir)}{renderEncryptionDirectoryField("output", "加密后文件夹目录", "选择加密后目录", encryptionOutputDir, setEncryptionOutputDir)}<div className="encryption-progress" aria-live="polite"><div className="encryption-progress-heading"><span>加密进度</span><strong>{encryptionProgressPercent}%</strong></div><div className="encryption-progress-bar" role="progressbar" aria-label="加密进度" aria-valuemin={0} aria-valuemax={encryptionProgress.total} aria-valuenow={encryptionProgress.current}><span style={{ width: `${encryptionProgressPercent}%` }} /></div><div className="encryption-progress-meta"><span>总文件数：{encryptionProgress.total}</span><span>已加密文件：{encryptionProgress.processedFiles}</span></div></div></div>{encryptionError && <DismissibleError message={encryptionError} onClose={() => setEncryptionError("")} />}<div className="button-row encryption-actions"><button className="primary" disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption("full")}>开始加密</button><button className="encryption-incremental-button" disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption("incremental")}>增量加密</button></div>{encryptionLogs.length > 0 && <pre className="encryption-log">{encryptionLogs.join("\n")}</pre>}</section>;
  if (page === "logs") return <section className="panel"><p className="eyebrow">运行记录</p><h2>{logs.length} 条日志</h2><p className="muted">可在日志页面查看近期服务活动。</p></section>;
  return null;
}
