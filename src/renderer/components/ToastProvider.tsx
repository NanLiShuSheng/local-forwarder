import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TOAST_DURATION_MS, toUserError, type ToastKind, type ToastRecord } from "../toast";

interface ToastInput {
  kind?: ToastKind;
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastContextValue {
  notify(input: ToastInput): string;
  notifyError(error: unknown, fallback?: string): string;
  dismiss(id: string): void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);
let nextToastId = 0;

function iconForKind(kind: ToastKind): string {
  if (kind === "error") return "!";
  if (kind === "success") return "✓";
  if (kind === "warning") return "!";
  if (kind === "info") return "i";
  return "×";
}

function defaultTitle(kind: ToastKind): string {
  if (kind === "success") return "操作成功";
  if (kind === "warning") return "请注意";
  if (kind === "info") return "提示";
  return "操作失败";
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastRecord[]; onDismiss: (id: string) => void }) {
  return <div className="toast-viewport" role="region" aria-label="操作提示" aria-live="polite">
    {toasts.map((toast) => <div className={`toast-card ${toast.kind}`} key={toast.id} role={toast.kind === "error" ? "alert" : "status"}>
      <span className="toast-icon" aria-hidden="true">{iconForKind(toast.kind)}</span>
      <div className="toast-card-copy"><strong className="toast-card-title">{toast.title}</strong><span className="toast-card-message">{toast.message}</span></div>
      <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => onDismiss(toast.id)}>×</button>
    </div>)}
  </div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const toastsRef = useRef<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    const next = toastsRef.current.filter((toast) => toast.id !== id);
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const notify = useCallback((input: ToastInput): string => {
    const message = input.message.trim();
    if (message === "") return "";
    const kind = input.kind ?? "info";
    const existing = toastsRef.current.find((toast) => toast.message === message);
    const id = existing?.id ?? `toast-${Date.now()}-${nextToastId++}`;
    const toast: ToastRecord = { id, kind, title: input.title ?? defaultTitle(kind), message };
    const next = existing === undefined
      ? [...toastsRef.current, toast].slice(-3)
      : toastsRef.current.map((current) => current.id === existing.id ? toast : current);
    for (const removed of toastsRef.current.filter((current) => !next.some((toastItem) => toastItem.id === current.id))) {
      const timer = timers.current.get(removed.id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timers.current.delete(removed.id);
      }
    }
    toastsRef.current = next;
    setToasts(next);
    const previousTimer = timers.current.get(id);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => dismiss(id), input.durationMs ?? TOAST_DURATION_MS);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  const notifyError = useCallback((error: unknown, fallback = "操作失败") => notify({ kind: "error", message: toUserError(error, fallback) }), [notify]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }, []);

  return <ToastContext.Provider value={{ notify, notifyError, dismiss }}>
    {children}
    <ToastViewport toasts={toasts} onDismiss={dismiss} />
  </ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === undefined) throw new Error("useToast 必须在 ToastProvider 内使用");
  return context;
}
