import { useEffect, useState } from "react";
import { AutoComplete, Button } from "antd";
import { PushpinFilled, PushpinOutlined } from "@ant-design/icons";
import type { AppConfig, EncryptionDirectoryKind, EncryptionMode, EncryptionPreferences, EncryptionPreferencesPatch, EncryptionProgress, EncryptionResult, ForwardingAddressHistory, LogEntry, ManualRequestConfig, ManualRequestResponse, StoredValues } from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import { formatLocalCacheText, parseLocalCacheText, splitH5StoreEntries } from "../../shared/local-cache";
import { RequestPage } from "./RequestPage";
import { StringToolPage } from "./StringToolPage";
import { useToast } from "./ToastProvider";

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
  mapValues: Record<string, string>;
  fileValues: Record<string, string>;
  onSaveSharedValues: (values: Record<string, string>) => Promise<boolean>;
  onSaveLoginCache: (values: Record<string, string>) => Promise<boolean>;
  onSaveStoredValues: (values: StoredValues) => Promise<boolean>;
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

export interface AddressDraft { id: string; name: string; address: string; }

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

export function removeForwardingAddressHistory(history: AppConfig["forwardingAddressHistory"], key: keyof ForwardingAddressHistory, address: string): ForwardingAddressHistory {
  const next: ForwardingAddressHistory = {
    hq: forwardingAddressHistoryForTarget(history, "hq"),
    jy: forwardingAddressHistoryForTarget(history, "jy"),
    zx: forwardingAddressHistoryForTarget(history, "zx"),
  };
  next[key] = next[key].filter((entry) => entry !== address);
  return next;
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
  };
}

export function ConfigPages({ page, config, logs, onChange, encryptionPreferences, onSelectEncryptionDirectory, onSaveEncryptionPreferences, onEncryptDirectory, onEncryptionProgress, onSendRequest, sharedValues, loginCache, mapValues, fileValues, onSaveSharedValues, onSaveLoginCache, onSaveStoredValues }: ConfigPagesProps) {
  const { notifyError } = useToast();
  const [addressDrafts, setAddressDrafts] = useState(() => draftsForTargets(config.tcpTargets));
  const [openEncryptionHistoryKind, setOpenEncryptionHistoryKind] = useState<EncryptionDirectoryKind>();
  const [localText, setLocalText] = useState(() => formatLocalCacheText(sharedValues));
  const [cacheText, setCacheText] = useState(() => formatLocalCacheText(loginCache));
  const [localEditing, setLocalEditing] = useState(false);
  const [cacheEditing, setCacheEditing] = useState(false);
  const [h5Text, setH5Text] = useState(() => formatLocalCacheText({ ...mapValues, ...fileValues }));
  const [h5Editing, setH5Editing] = useState(false);
  const [loginText, setLoginText] = useState(() => formatLocalCacheText(loginCache));
  const [loginEditing, setLoginEditing] = useState(false);
  const [encryptionInputDir, setEncryptionInputDir] = useState(() => encryptionPreferences.inputDir);
  const [encryptionOutputDir, setEncryptionOutputDir] = useState(() => encryptionPreferences.outputDir);
  const [encryptionRunning, setEncryptionRunning] = useState(false);
  const [encryptionLogs, setEncryptionLogs] = useState<string[]>([]);
  const [encryptionProgress, setEncryptionProgress] = useState({ current: 0, total: 0, processedFiles: 0 });
  useEffect(() => { setAddressDrafts(draftsForTargets(config.tcpTargets)); }, [config.tcpTargets]);
  useEffect(() => { if (!localEditing) setLocalText(formatLocalCacheText(sharedValues)); }, [sharedValues, localEditing]);
  useEffect(() => { if (!cacheEditing) setCacheText(formatLocalCacheText(loginCache)); }, [loginCache, cacheEditing]);
  useEffect(() => { if (!h5Editing) setH5Text(formatLocalCacheText({ ...mapValues, ...fileValues })); }, [mapValues, fileValues, h5Editing]);
  useEffect(() => { if (!loginEditing) setLoginText(formatLocalCacheText(loginCache)); }, [loginCache, loginEditing]);
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
    if (openEncryptionHistoryKind === undefined) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".address-input-shell") !== null) {
        setOpenEncryptionHistoryKind(undefined);
        return;
      }
      const encryptionShell = target instanceof Element ? target.closest(".encryption-input-shell") : null;
      if (encryptionShell !== null) {
        const encryptionKind = encryptionShell.getAttribute("data-encryption-kind");
        if (encryptionKind !== openEncryptionHistoryKind) {
          setOpenEncryptionHistoryKind(undefined);
        }
        return;
      }
      setOpenEncryptionHistoryKind(undefined);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [openEncryptionHistoryKind]);

  const saveLocalValues = async (text: string): Promise<boolean> => {
    try {
      const parsed = parseLocalCacheText(text);
      return await onSaveSharedValues(parsed);
    } catch {
      return false;
    }
  };

  const saveH5Values = async (text: string): Promise<boolean> => {
    try {
      const parsed = splitH5StoreEntries(parseLocalCacheText(text), mapValues, fileValues);
      return await onSaveStoredValues(parsed);
    } catch {
      return false;
    }
  };

  const saveLoginSectionValues = async (text: string): Promise<boolean> => {
    try {
      const pasted = parseLocalCacheText(text);
      return await onSaveLoginCache(pasted);
    } catch {
      return false;
    }
  };

  const saveLoginCache = async (): Promise<boolean> => {
    try {
      const pasted = parseLocalCacheText(cacheText);
      return await onSaveLoginCache(pasted);
    } catch (error) {
      notifyError(error, "登录缓存格式无效");
      return false;
    }
  };

  const saveAddressDrafts = async (drafts: typeof addressDrafts) => {
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

  const applyAddressDrafts = async (drafts: typeof addressDrafts) => {
    try {
      const firstEmpty = drafts.findIndex((draft) => draft.address.trim() === "");
      if (firstEmpty >= 0 && drafts.slice(firstEmpty + 1).some((draft) => draft.address.trim() !== "")) return;
      const tcpTargets = drafts.filter((draft) => draft.address.trim() !== "").map((draft, index) => targetFromDraft(draft, index));
      await window.forwarder.applyForwardingTargets(tcpTargets);
    } catch {
      // 输入中间态不合法时不热应用
    }
  };

  const changeAddress = (index: number, value: string) => {
    const next = addressDrafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, address: value } : draft);
    setAddressDrafts(next);
    void applyAddressDrafts(next);
  };

  const toggleCardTarget = async (index: number) => {
    const target = config.tcpTargets[index];
    if (target === undefined) return;
    await onChange({ ...config, cardTargetId: config.cardTargetId === target.id ? undefined : target.id });
  };

  const removeAddressHistory = async (index: number, address: string) => {
    const historyKey = addressLabels[index];
    if (historyKey === undefined) return;
    try {
      await onChange({ ...config, forwardingAddressHistory: removeForwardingAddressHistory(config.forwardingAddressHistory, historyKey, address) });
    } catch (error) {
      notifyError(error, "历史地址删除失败");
    }
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
    setEncryptionProgress({ current: 0, total: 0, processedFiles: 0 });
    try {
      const result = await onEncryptDirectory(encryptionInputDir, encryptionOutputDir, mode);
      if (!result.ok) {
        return;
      }
      const total = result.totalFiles ?? 0;
      const processed = result.processedFiles ?? total;
      const skipped = result.skippedFiles ?? 0;
      const removed = result.removedFiles ?? 0;
      setEncryptionProgress({ current: total, total, processedFiles: processed });
      setEncryptionLogs((current) => [...current, "", `完成：处理 ${processed} 个，跳过 ${skipped} 个，删除 ${removed} 个（共 ${total} 个）`].slice(-200));
    } catch (error) {
      notifyError(error, "加密失败");
    } finally {
      setEncryptionRunning(false);
    }
  };

  const encryptionProgressPercent = encryptionProgress.total === 0
    ? 0
    : Math.min(100, Math.round((encryptionProgress.current / encryptionProgress.total) * 100));

  const renderEncryptionDirectoryField = (kind: EncryptionDirectoryKind, label: string, chooseLabel: string, directory: string, setDirectory: (value: string) => void) => {
    const history = encryptionDirectoryHistoryForKind(encryptionPreferences, kind);
    return <label className="encryption-directory-field">{label}<div className="input-with-button"><div className="encryption-input-shell" data-encryption-kind={kind}><input className="encryption-directory-input" disabled={encryptionRunning} value={directory} placeholder="粘贴 file:/// URL 或本地目录路径" onChange={(event) => setDirectory(event.target.value)} onBlur={() => void saveEncryptionDirectory(kind, directory)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveEncryptionDirectory(kind, directory); } }} /><button type="button" className="address-history-toggle encryption-history-toggle" aria-label={kind === "input" ? "显示加密前目录历史" : "显示加密后目录历史"} aria-expanded={openEncryptionHistoryKind === kind} disabled={encryptionRunning || history.length === 0} onClick={() => setOpenEncryptionHistoryKind((current) => current === kind ? undefined : kind)}><span className="address-history-chevron encryption-history-chevron" aria-hidden="true" /></button>{openEncryptionHistoryKind === kind && <div className="address-history-menu encryption-history-menu" role="listbox" aria-label={kind === "input" ? "加密前目录历史" : "加密后目录历史"}>{history.map((directory) => <button type="button" role="option" aria-selected={directory === (kind === "input" ? encryptionInputDir : encryptionOutputDir)} className="address-history-option encryption-history-option" disabled={encryptionRunning} key={directory} onMouseDown={(event) => event.preventDefault()} onClick={() => selectEncryptionHistory(kind, directory)}>{directory}</button>)}</div>}</div><button type="button" disabled={encryptionRunning} onClick={() => void chooseEncryptionDirectory(kind)}>{chooseLabel}</button></div></label>;
  };

  if (page === "addresses") return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">/reqxml</p><h2>转发地址</h2></div></div>{addressDrafts.map((draft, index) => { const pinnedTarget = config.tcpTargets[index]; const pinned = pinnedTarget !== undefined && config.cardTargetId === pinnedTarget.id; return <div className="address-editor" key={draft.id}><Button className={`address-card-pin${pinned ? " pinned" : ""}`} type="text" size="small" aria-label={pinned ? "取消在卡片展示" : "在卡片展示"} aria-pressed={pinned} icon={pinned ? <PushpinFilled /> : <PushpinOutlined />} onClick={() => void toggleCardTarget(index)} /><label className="address-field"><span>{addressLabels[index] ?? `地址${index + 1}`} 地址</span><div className="address-input-shell"><AutoComplete className="address-input" value={draft.address} placeholder={forwardingAddressPlaceholder(index)} options={addressHistoryForIndex(index).map((address) => ({ value: address, label: <span className="address-history-choice"><span className="address-history-choice-text">{address}</span><Button type="text" size="small" danger aria-label={`删除历史地址 ${address}`} onClick={(event) => { event.stopPropagation(); void removeAddressHistory(index, address); }}>×</Button></span> }))} onChange={(value) => changeAddress(index, value)} /></div></label><div className="address-actions"><Button type="primary" onClick={() => void saveAddressDrafts(addressDrafts)}>保存</Button></div></div>; })}</section>;
  if (page === "request") return <RequestPage config={config} onChange={onChange} onSendRequest={onSendRequest} />;
  if (page === "string") return <StringToolPage config={config} />;
  if (page === "local") return <section className="panel config-textarea-panel">
    <p className="muted config-textarea-hint">三段缓存均可按“键 = 值”逐行编辑，修改后自动保存。</p>
    <p className="eyebrow">h5</p>
    <h2>H5 写入缓存</h2>
    <textarea className="config-textarea h5-values-input" aria-label="H5 写入缓存" value={h5Text} onChange={(event) => { setH5Text(event.target.value); void saveH5Values(event.target.value); }} onFocus={() => setH5Editing(true)} onBlur={() => setH5Editing(false)} placeholder="PLAY_STATUS.TXT = 1" rows={8} />
    <p className="eyebrow">login</p>
    <h2>登录缓存（登录后捕获）</h2>
    <textarea className="config-textarea login-section-input" aria-label="登录缓存（登录后捕获）" value={loginText} onChange={(event) => { setLoginText(event.target.value); void saveLoginSectionValues(event.target.value); }} onFocus={() => setLoginEditing(true)} onBlur={() => setLoginEditing(false)} placeholder="Token = xxx" rows={8} />
    <p className="eyebrow">local</p>
    <h2>本地缓存（客户端读取）</h2>
    <textarea className="config-textarea local-values-input" aria-label="本地变量输入" value={localText} onChange={(event) => { setLocalText(event.target.value); void saveLocalValues(event.target.value); }} onFocus={() => setLocalEditing(true)} onBlur={() => setLocalEditing(false)} placeholder="localKey = value\nAnotherKey = another value" rows={6} />
  </section>;
  if (page === "values") return <section className="panel config-textarea-panel">
    <p className="muted config-textarea-hint">当前代理已缓存 {Object.keys(loginCache).length} 项，登录请求成功后会自动更新。</p>
    <textarea className="config-textarea login-cache-input" aria-label="登录缓存" value={cacheText} onChange={(event) => setCacheText(event.target.value)} onFocus={() => setCacheEditing(true)} onBlur={() => void saveLoginCache().then((saved) => { if (saved) setCacheEditing(false); })} placeholder="Token = xxx\nSessionNo = 123" rows={14} />
  </section>;
  if (page === "cache") return <section className="panel"><p className="eyebrow">资源管理</p><h2>缓存</h2><dl className="settings-list"><div><dt>根目录</dt><dd>{config.cache.rootDir || "默认应用缓存"}</dd></div><div><dt>下载目标</dt><dd>{config.cache.downloadTarget || "未配置"}</dd></div><div><dt>解密 .d 资源</dt><dd>{config.cache.decryptEnabled ? "已启用" : "已停用"}</dd></div></dl></section>;
  if (page === "encryption") return <section className="panel encryption-panel"><div className="encryption-directory-list">{renderEncryptionDirectoryField("input", "加密前文件夹目录", "选择加密前目录", encryptionInputDir, setEncryptionInputDir)}{renderEncryptionDirectoryField("output", "加密后文件夹目录", "选择加密后目录", encryptionOutputDir, setEncryptionOutputDir)}<div className="encryption-progress" aria-live="polite"><div className="encryption-progress-heading"><span>加密进度</span><strong>{encryptionProgressPercent}%</strong></div><div className="encryption-progress-bar" role="progressbar" aria-label="加密进度" aria-valuemin={0} aria-valuemax={encryptionProgress.total} aria-valuenow={encryptionProgress.current}><span style={{ width: `${encryptionProgressPercent}%` }} /></div><div className="encryption-progress-meta"><span>总文件数：{encryptionProgress.total}</span><span>已加密文件：{encryptionProgress.processedFiles}</span></div></div></div><div className="button-row encryption-actions"><button className="primary" disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption("full")}>开始加密</button><button className="encryption-incremental-button" disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption("incremental")}>增量加密</button></div>{encryptionLogs.length > 0 && <pre className="encryption-log">{encryptionLogs.join("\n")}</pre>}</section>;
  if (page === "logs") return <section className="panel"><p className="eyebrow">运行记录</p><h2>{logs.length} 条日志</h2><p className="muted">可在日志页面查看近期服务活动。</p></section>;
  return null;
}
