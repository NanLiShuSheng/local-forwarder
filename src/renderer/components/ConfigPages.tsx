import { useEffect, useState } from "react";
import type { AppConfig, EncryptionDirectoryKind, EncryptionResult, LogEntry } from "../../shared/contracts";
import { parseLocalCacheText } from "../../shared/local-cache";

export type Page = "runtime" | "rules" | "addresses" | "local" | "values" | "cache" | "encryption" | "logs" | "settings";
interface ConfigPagesProps {
  page: Page;
  config: AppConfig;
  logs: LogEntry[];
  onChange: (config: AppConfig) => Promise<boolean>;
  onImport: () => Promise<void>;
  onExport: () => Promise<void>;
  onChooseProjectDirectory: () => Promise<boolean>;
  onSelectEncryptionDirectory: (kind: EncryptionDirectoryKind) => Promise<string | undefined>;
  onEncryptDirectory: (inputDir: string, outputDir: string) => Promise<EncryptionResult>;
}
const addressLabels = ["hq", "jy", "zx"];

export interface AddressDraft { id: string; name: string; address: string; enabled: boolean; }

export function addressForTarget(target: AppConfig["tcpTargets"][number]): string {
  const protocol = target.transport === "http" ? target.protocol ?? "http" : "tcp";
  const host = target.host.includes(":") && !target.host.startsWith("[") ? `[${target.host}]` : target.host;
  return `${protocol}://${host}:${target.port}${target.basePath ?? ""}`;
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

export function ConfigPages({ page, config, logs, onChange, onImport, onExport, onChooseProjectDirectory, onSelectEncryptionDirectory, onEncryptDirectory }: ConfigPagesProps) {
  const [addressDrafts, setAddressDrafts] = useState(() => draftsForTargets(config.tcpTargets));
  const [addressError, setAddressError] = useState("");
  const [localText, setLocalText] = useState(() => config.localText ?? "");
  const [localError, setLocalError] = useState("");
  const [cacheText, setCacheText] = useState("");
  const [cacheError, setCacheError] = useState("");
  const [encryptionInputDir, setEncryptionInputDir] = useState("");
  const [encryptionOutputDir, setEncryptionOutputDir] = useState("");
  const [encryptionRunning, setEncryptionRunning] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState("未开始");
  const [encryptionError, setEncryptionError] = useState("");
  const [encryptionLogs, setEncryptionLogs] = useState<string[]>([]);
  const [encryptionTotal, setEncryptionTotal] = useState(0);
  useEffect(() => { setAddressDrafts(draftsForTargets(config.tcpTargets)); }, [config.tcpTargets]);
  useEffect(() => { setLocalText(config.localText ?? ""); }, [config.localText]);

  const saveLocalValues = async () => {
    try {
      const parsed = parseLocalCacheText(localText);
      if (Object.keys(parsed).length === 0) {
        const saved = await onChange({ ...config, localText: localText });
        setLocalError(saved ? "" : "配置未保存，请先停止服务");
        return;
      }
      const saved = await onChange({ ...config, localText: localText, localValues: { ...config.localValues, ...parsed } });
      if (saved) {
        setLocalError("");
      } else {
        setLocalError("配置未保存，请先停止服务");
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "本地变量格式无效");
    }
  };

  const chooseEncryptionDirectory = async (kind: EncryptionDirectoryKind) => {
    setEncryptionError("");
    const selectedPath = await onSelectEncryptionDirectory(kind);
    if (selectedPath === undefined) return;
    if (kind === "input") setEncryptionInputDir(selectedPath);
    else setEncryptionOutputDir(selectedPath);
    setEncryptionStatus(`已选择${kind === "input" ? "加密前" : "加密后"}目录`);
  };

  const startEncryption = async () => {
    if (!encryptionInputDir || !encryptionOutputDir) {
      setEncryptionError("请先选择加密前和加密后文件夹目录");
      return;
    }
    setEncryptionRunning(true);
    setEncryptionError("");
    setEncryptionLogs(["开始执行加密任务…"]);
    setEncryptionStatus("加密中，请稍候…");
    try {
      const result = await onEncryptDirectory(encryptionInputDir, encryptionOutputDir);
      if (!result.ok) {
        setEncryptionError(result.error ?? "加密失败");
        setEncryptionStatus("加密失败");
        setEncryptionLogs([`失败：${result.error ?? "加密失败"}`]);
        return;
      }
      const total = result.totalFiles ?? 0;
      setEncryptionTotal(total);
      setEncryptionStatus(`加密完成，共处理 ${total} 个文件`);
      setEncryptionLogs([...(result.logs ?? []), "", `完成文件数：${total}`]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加密失败";
      setEncryptionError(message);
      setEncryptionStatus("加密失败");
      setEncryptionLogs([`失败：${message}`]);
    } finally {
      setEncryptionRunning(false);
    }
  };

  if (page === "addresses") return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">/reqxml</p><h2>转发地址</h2></div></div><p className="muted">按 hq、jy、zx 顺序配置旧版 Node 转发地址。直接填写主机:端口时按 TCP 处理；HTTP、HTTPS 地址请保留协议前缀。</p>{addressDrafts.map((draft, index) => <div className="address-editor" key={draft.id}><label>{addressLabels[index] ?? `地址${index + 1}`} 地址<input value={draft.address} placeholder={index === 0 ? "主机:端口" : "http://主机:端口"} onChange={(event) => setAddressDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} /></label><label className="address-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setAddressDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />启用</label></div>)}{addressError && <p className="error-box" role="alert">{addressError}</p>}<div className="button-row"><button className="primary" onClick={() => { try { const firstEmpty = addressDrafts.findIndex((draft) => draft.address.trim() === ""); const laterFilled = firstEmpty >= 0 && addressDrafts.slice(firstEmpty + 1).some((draft) => draft.address.trim() !== ""); if (laterFilled) throw new Error("请按 hq、jy、zx 顺序填写地址"); void onChange({ ...config, tcpTargets: addressDrafts.filter((draft) => draft.address.trim() !== "").map((draft, index) => targetFromDraft(draft, index)) }); setAddressError(""); } catch (error) { setAddressError(error instanceof Error ? error.message : "地址配置无效"); } }}>保存转发地址</button></div></section>;
  if (page === "local") return <section className="panel"><p className="eyebrow">本地变量</p><h2>本地变量</h2><p className="muted">可直接输入本地变量，按“键 = 值”逐行填写，离开输入框后自动保存。</p><textarea className="local-values-input" aria-label="本地变量输入" value={localText} onChange={(event) => setLocalText(event.target.value)} onBlur={() => void saveLocalValues()} placeholder="localKey = value\nAnotherKey = another value" rows={10} />{localError && <p className="error-box" role="alert">{localError}</p>}</section>;
  if (page === "values") return <section className="panel"><p className="eyebrow">登录状态</p><h2>登录缓存</h2><p className="muted">可直接粘贴旧版 _local 内容，按“键 = 值”逐行填写。</p><textarea aria-label="粘贴登录缓存" value={cacheText} onChange={(event) => setCacheText(event.target.value)} placeholder="Token = xxx\nSessionNo = 123" rows={8} />{cacheError && <p className="error-box" role="alert">{cacheError}</p>}<div className="button-row"><button className="primary" onClick={() => { try { const pasted = parseLocalCacheText(cacheText); if (Object.keys(pasted).length === 0) throw new Error("请输入登录缓存内容"); void onChange({ ...config, localValues: { ...config.localValues, ...pasted } }).then((saved) => { if (saved) { setCacheText(""); setCacheError(""); } else setCacheError("配置未保存，请先停止服务"); }); } catch (error) { setCacheError(error instanceof Error ? error.message : "登录缓存格式无效"); } }}>保存登录缓存</button></div><p className="muted">当前缓存 {Object.keys(config.localValues).length} 项。</p></section>;
  if (page === "cache") return <section className="panel"><p className="eyebrow">资源管理</p><h2>缓存</h2><dl className="settings-list"><div><dt>根目录</dt><dd>{config.cache.rootDir || "默认应用缓存"}</dd></div><div><dt>下载目标</dt><dd>{config.cache.downloadTarget || "未配置"}</dd></div><div><dt>解密 .d 资源</dt><dd>{config.cache.decryptEnabled ? "已启用" : "已停用"}</dd></div></dl></section>;
  if (page === "encryption") return <section className="panel encryption-panel"><p className="eyebrow">H5 资源编码</p><h2>选择目录并开始加密</h2><p className="muted encryption-description">递归处理目录中的普通文件，跳过隐藏项、node_modules、dist 和 .map 文件，输出文件保留目录结构并追加 .d 后缀。</p><div className="encryption-directory-list"><label className="encryption-directory-field">加密前文件夹目录<div className="input-with-button"><input readOnly value={encryptionInputDir} placeholder="请选择源文件夹目录" /><button type="button" disabled={encryptionRunning} onClick={() => void chooseEncryptionDirectory("input")}>选择加密前目录</button></div></label><label className="encryption-directory-field">加密后文件夹目录<div className="input-with-button"><input readOnly value={encryptionOutputDir} placeholder="请选择输出文件夹目录" /><button type="button" disabled={encryptionRunning} onClick={() => void chooseEncryptionDirectory("output")}>选择加密后目录</button></div></label></div>{encryptionError && <p className="error-box" role="alert">{encryptionError}</p>}<div className="button-row encryption-actions"><button className="primary" disabled={encryptionRunning || !encryptionInputDir || !encryptionOutputDir} onClick={() => void startEncryption()}>开始加密</button><span className={`encryption-status ${encryptionRunning ? "running" : ""}`}>{encryptionStatus}</span></div><div className="encryption-status-grid"><div className="encryption-status"><span>处理进度</span><strong>{encryptionRunning ? "处理中" : `${encryptionTotal} 个文件`}</strong></div><div className="encryption-status"><span>最近结果</span><strong>{encryptionStatus}</strong></div></div>{encryptionLogs.length > 0 && <pre className="encryption-log">{encryptionLogs.join("\n")}</pre>}</section>;
  if (page === "settings") return <section className="panel"><p className="eyebrow">配置</p><h2>设置</h2><div className="form-grid"><label className="project-directory-field">项目目录<div className="input-with-button"><input value={config.projectPath ?? ""} readOnly placeholder="本地 H5 项目目录" /><button type="button" onClick={() => void onChooseProjectDirectory()}>选择项目目录</button></div></label><label>监听主机<input value={config.server.bindHost} onChange={(event) => void onChange({ ...config, server: { ...config.server, bindHost: event.target.value } })} /></label><label>端口<input type="number" value={config.server.port} onChange={(event) => void onChange({ ...config, server: { ...config.server, port: Number(event.target.value) } })} /></label><label>超时时间（毫秒）<input type="number" value={config.server.timeoutMs} onChange={(event) => void onChange({ ...config, server: { ...config.server, timeoutMs: Number(event.target.value) } })} /></label></div><div className="button-row"><button onClick={() => void onImport()}>导入旧版配置</button><button onClick={() => void onExport()}>导出旧版配置</button></div></section>;
  if (page === "logs") return <section className="panel"><p className="eyebrow">运行记录</p><h2>{logs.length} 条日志</h2><p className="muted">可在日志页面查看近期服务活动。</p></section>;
  return null;
}
