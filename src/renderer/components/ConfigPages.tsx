import { useEffect, useState } from "react";
import type { AppConfig, LogEntry } from "../../shared/contracts";

export type Page = "runtime" | "rules" | "addresses" | "values" | "cache" | "logs" | "settings";
interface ConfigPagesProps { page: Page; config: AppConfig; logs: LogEntry[]; onChange: (config: AppConfig) => Promise<void>; onImport: () => Promise<void>; onExport: () => Promise<void>; }
const sensitive = /password|token|secret|account|authorization|mobile/i;
const addressLabels = ["hq", "jy", "zx"];

interface AddressDraft { id: string; name: string; address: string; enabled: boolean; }

function addressForTarget(target: AppConfig["tcpTargets"][number]): string {
  const protocol = target.transport === "tcp" ? "tcp" : target.protocol ?? "http";
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

function targetFromDraft(draft: AddressDraft, index: number): AppConfig["tcpTargets"][number] {
  const raw = draft.address.trim();
  const parsed = new URL(raw.includes("://") ? raw : `tcp://${raw}`);
  if (parsed.protocol !== "tcp:" && parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`${addressLabels[index] ?? "地址"} 地址协议不受支持`);
  if (!parsed.hostname) throw new Error(`${addressLabels[index] ?? "地址"} 地址缺少主机名`);
  const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : 0) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${addressLabels[index] ?? "地址"} 地址端口无效`);
  return {
    id: draft.id,
    name: draft.name,
    host: parsed.hostname,
    port,
    ...(parsed.protocol === "http:" || parsed.protocol === "https:" ? { protocol: parsed.protocol.slice(0, -1) as "http" | "https" } : {}),
    ...(parsed.pathname !== "/" ? { basePath: parsed.pathname.replace(/\/+$/, "") } : {}),
    ...(parsed.protocol === "http:" || parsed.protocol === "https:" ? { transport: "http" as const } : {}),
    enabled: draft.enabled,
  };
}

export function ConfigPages({ page, config, logs, onChange, onImport, onExport }: ConfigPagesProps) {
  const [addressDrafts, setAddressDrafts] = useState(() => draftsForTargets(config.tcpTargets));
  const [addressError, setAddressError] = useState("");
  useEffect(() => { setAddressDrafts(draftsForTargets(config.tcpTargets)); }, [config.tcpTargets]);
  if (page === "addresses") return <section className="panel"><div className="panel-heading"><div><p className="eyebrow">/reqxml</p><h2>转发地址</h2></div></div><p className="muted">按 hq、jy、zx 顺序配置旧版 Node 转发地址。支持 tcp://、http:// 和 https:// 地址。</p>{addressDrafts.map((draft, index) => <div className="address-editor" key={draft.id}><label>{addressLabels[index] ?? `地址${index + 1}`} 地址<input value={draft.address} placeholder={index === 0 ? "tcp://主机:端口" : "https://主机/路径"} onChange={(event) => setAddressDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, address: event.target.value } : item))} /></label><label className="address-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setAddressDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item))} />启用</label></div>)}{addressError && <p className="error-box" role="alert">{addressError}</p>}<div className="button-row"><button className="primary" onClick={() => { try { const firstEmpty = addressDrafts.findIndex((draft) => draft.address.trim() === ""); const laterFilled = firstEmpty >= 0 && addressDrafts.slice(firstEmpty + 1).some((draft) => draft.address.trim() !== ""); if (laterFilled) throw new Error("请按 hq、jy、zx 顺序填写地址"); void onChange({ ...config, tcpTargets: addressDrafts.filter((draft) => draft.address.trim() !== "").map((draft, index) => targetFromDraft(draft, index)) }); setAddressError(""); } catch (error) { setAddressError(error instanceof Error ? error.message : "地址配置无效"); } }}>保存转发地址</button></div></section>;
  if (page === "values") return <><section className="panel"><p className="eyebrow">本地变量</p><h2>变量</h2><div className="value-list">{Object.entries(config.localValues).map(([key, value]) => <div key={key}><strong>{key}</strong><span>{sensitive.test(key) ? "••••••••" : value}</span></div>)}</div></section><section className="panel"><p className="eyebrow">登录状态</p><h2>登录缓存</h2><p className="muted">旧版 config.js 中的 _local 登录信息会导入这里，并在登录成功后自动保存。</p><p className="muted">当前缓存 {Object.keys(config.localValues).length} 项。</p></section></>;
  if (page === "cache") return <section className="panel"><p className="eyebrow">资源管理</p><h2>缓存</h2><dl className="settings-list"><div><dt>根目录</dt><dd>{config.cache.rootDir || "默认应用缓存"}</dd></div><div><dt>下载目标</dt><dd>{config.cache.downloadTarget || "未配置"}</dd></div><div><dt>解密 .d 资源</dt><dd>{config.cache.decryptEnabled ? "已启用" : "已停用"}</dd></div></dl></section>;
  if (page === "settings") return <section className="panel"><p className="eyebrow">配置</p><h2>设置</h2><div className="form-grid"><label>项目目录<input value={config.projectPath ?? ""} onChange={(event) => void onChange({ ...config, projectPath: event.target.value })} placeholder="本地 H5 项目目录" /></label><label>监听主机<input value={config.server.bindHost} onChange={(event) => void onChange({ ...config, server: { ...config.server, bindHost: event.target.value } })} /></label><label>端口<input type="number" value={config.server.port} onChange={(event) => void onChange({ ...config, server: { ...config.server, port: Number(event.target.value) } })} /></label><label>超时时间（毫秒）<input type="number" value={config.server.timeoutMs} onChange={(event) => void onChange({ ...config, server: { ...config.server, timeoutMs: Number(event.target.value) } })} /></label></div><div className="button-row"><button onClick={() => void onImport()}>导入旧版配置</button><button onClick={() => void onExport()}>导出旧版配置</button></div></section>;
  if (page === "logs") return <section className="panel"><p className="eyebrow">运行记录</p><h2>{logs.length} 条日志</h2><p className="muted">可在日志页面查看近期服务活动。</p></section>;
  return null;
}
