import { useEffect, useState } from "react";
import type { UpdateState } from "../../shared/contracts";

export interface UpdateCardProps {
  state: UpdateState;
  dismissedVersion?: string;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value;
  let unit = "B";
  for (const nextUnit of units) {
    amount /= 1024;
    unit = nextUnit;
    if (amount < 1024 || nextUnit === units.at(-1)) break;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`;
}

export function UpdateCard({ state, dismissedVersion, onDownload, onInstall, onDismiss }: UpdateCardProps) {
  const version = state.update?.version;
  const [downloadedVersion, setDownloadedVersion] = useState<string>();

  useEffect(() => {
    if (state.state === "downloaded" && version !== undefined) {
      setDownloadedVersion(version);
    } else if (state.state === "available" || state.state === "downloading") {
      setDownloadedVersion(undefined);
    }
  }, [state.state, version]);

  const visible = version !== undefined
    && (state.state === "available" || state.state === "downloading" || state.state === "downloaded" || state.state === "error")
    && dismissedVersion !== version;
  if (!visible) return null;

  const percent = Math.max(0, Math.min(100, state.progress?.percent ?? 0));
  const canInstall = state.state === "downloaded" || (state.state === "error" && downloadedVersion === version);
  const isDownloading = state.state === "downloading";

  return <aside className="update-card" role="region" aria-label="软件更新">
    <div className="update-card-header">
      <div>
        <p className="update-card-eyebrow">发现新版本</p>
        <h2>版本 {state.currentVersion} → {version}</h2>
      </div>
      <button type="button" className="update-card-close" aria-label="稍后更新" onClick={onDismiss}>×</button>
    </div>
    {isDownloading && <div className="update-card-progress-wrap">
      <div className="update-card-progress-heading"><span>下载进度</span><strong>{Math.round(percent)}%</strong></div>
      <progress className="update-card-progress" max={100} value={percent} aria-label="下载进度" />
      <div className="update-card-progress-meta"><span>{formatBytes(state.progress?.transferred ?? 0)} / {formatBytes(state.progress?.total ?? 0)}</span><span>{formatBytes(state.progress?.bytesPerSecond ?? 0)}/s</span></div>
    </div>}
    {state.state === "error" && state.error !== undefined && <p className="update-card-error">{state.error}</p>}
    {state.state === "downloaded" && <p className="update-card-message">更新已下载</p>}
    {state.state === "available" && <p className="update-card-message">准备下载版本 {version}</p>}
    {isDownloading && <p className="update-card-message">正在下载更新 {Math.round(percent)}%</p>}
    <div className="update-card-actions">
      {!canInstall && <button type="button" className="button-row-button primary" disabled={isDownloading} onClick={onDownload}>{state.state === "error" ? "重新下载" : "下载更新"}</button>}
      {canInstall && <button type="button" className="button-row-button primary" onClick={onInstall}>立即重启更新</button>}
      {!isDownloading && <button type="button" className="button-row-button" onClick={onDismiss}>稍后更新</button>}
    </div>
  </aside>;
}
