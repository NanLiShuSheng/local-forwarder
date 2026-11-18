import { useEffect } from "react";

export interface UpdateCancelDialogProps {
  version?: string;
  busy: boolean;
  onContinue: () => void;
  onHide: () => void;
  onStop: () => void;
}

export function UpdateCancelDialog({ version, busy, onContinue, onHide, onStop }: UpdateCancelDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onContinue();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onContinue]);

  return <div
    className="update-cancel-overlay"
    onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onContinue();
    }}
  >
    <div
      className="update-cancel-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-cancel-title"
      aria-describedby="update-cancel-description"
      aria-busy={busy}
    >
      <p className="update-cancel-eyebrow">更新正在下载{version === undefined ? "" : ` · 版本 ${version}`}</p>
      <h2 id="update-cancel-title">要停止这次更新吗？</h2>
      <p className="update-cancel-description" id="update-cancel-description">隐藏窗口不会停止下载，完成后会再次提醒。停止更新会中断当前下载，之后可以重新下载。</p>
      <div className="update-cancel-actions">
        <button type="button" className="button-row-button update-cancel-stop" disabled={busy} onClick={onStop}>停止更新</button>
        <button type="button" className="button-row-button" disabled={busy} onClick={onHide}>仅隐藏窗口</button>
        <button type="button" className="button-row-button primary" autoFocus disabled={busy} onClick={onContinue}>继续下载</button>
      </div>
    </div>
  </div>;
}
