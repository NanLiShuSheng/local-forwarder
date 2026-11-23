import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DecryptionFailure,
  DecryptionPreferences,
  EncryptionMode,
  EncryptionPreferences,
} from "../../shared/contracts";
import { parseDirectoryInput } from "../../shared/directory-path";
import { getBuildModeStorage, readBuildEncryptionMode, writeBuildEncryptionMode } from "../build-mode-preference";
import type { BuildTask } from "./WorkspacePages";
import { useToast } from "./ToastProvider";
import { WorkspaceIcon } from "./WorkspaceChrome";

type BuildTab = "encrypt" | "decrypt";
type BuildPhase = "idle" | "scanning" | "running" | "completed" | "canceled" | "error";
type BuildLogLevel = "info" | "ok" | "skip" | "warn" | "error";

interface BuildLogEntry {
  id: number;
  time: string;
  level: BuildLogLevel;
  message: string;
}

interface BuildProgressState {
  phase: BuildPhase;
  current: number;
  total: number;
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface BuildPageProps {
  onCreateTask: (task: BuildTask) => void;
  onUpdateTask: (id: string, patch: Partial<BuildTask>) => void;
  onOpenJobs: () => void;
  backfillTask?: BuildTask;
  onBackfillApplied: () => void;
}

const initialEncryptionPreferences: EncryptionPreferences = { inputDir: "", outputDir: "", inputHistory: [], outputHistory: [], lowercaseOutput: false };
const initialDecryptionPreferences: DecryptionPreferences = { inputDir: "", outputDir: "", inputHistory: [], outputHistory: [] };
const initialProgress: BuildProgressState = { phase: "idle", current: 0, total: 0, processedFiles: 0, skippedFiles: 0, failedFiles: 0 };
const logLevelLabels: Record<BuildLogLevel, string> = { info: "INFO", ok: "OK", skip: "SKIP", warn: "WARN", error: "ERROR" };

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function clockTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function shortTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return "—";
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function pathName(value: string, fallback: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? fallback;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

export function formatBuildRemainingTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(seconds));
  if (totalSeconds < 60) return `${totalSeconds} 秒`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) return remainingSeconds === 0 ? `${totalMinutes} 分钟` : `${totalMinutes} 分 ${remainingSeconds} 秒`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function appendLog(current: BuildLogEntry[], level: BuildLogLevel, message: string, id: number): BuildLogEntry[] {
  return [...current, { id, time: clockTime(Date.now()), level, message }].slice(-240);
}

function phaseCopy(tab: BuildTab, progress: BuildProgressState, busy: boolean): string {
  if (progress.phase === "scanning") return "正在扫描";
  if (busy || progress.phase === "running") return tab === "encrypt" ? "正在加密" : "正在解密";
  if (progress.phase === "completed") return tab === "encrypt" ? "加密完成" : "还原完成";
  if (progress.phase === "canceled") return "任务已取消";
  if (progress.phase === "error") return tab === "encrypt" ? "加密失败" : "解密失败";
  return "等待开始";
}

function progressPercent(progress: BuildProgressState): number {
  if (progress.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((progress.current / progress.total) * 100)));
}

function progressTone(progress: BuildProgressState, busy: boolean): string {
  if (progress.phase === "error") return "error";
  if (progress.phase === "canceled") return "warn";
  if (progress.phase === "completed") return "success";
  return busy ? "running" : "idle";
}

export function BuildPage({ onCreateTask, onUpdateTask, onOpenJobs, backfillTask, onBackfillApplied }: BuildPageProps) {
  const { notify, notifyError } = useToast();
  const [tab, setTab] = useState<BuildTab>("encrypt");
  const [encryptionPreferences, setEncryptionPreferences] = useState(initialEncryptionPreferences);
  const [decryptionPreferences, setDecryptionPreferences] = useState(initialDecryptionPreferences);
  const [encryptionInput, setEncryptionInput] = useState("");
  const [encryptionOutput, setEncryptionOutput] = useState("");
  const [decryptionInput, setDecryptionInput] = useState("");
  const [decryptionOutput, setDecryptionOutput] = useState("");
  const [encryptionMode, setEncryptionMode] = useState<EncryptionMode>(() => readBuildEncryptionMode(getBuildModeStorage()));
  const [lowercaseOutput, setLowercaseOutput] = useState(false);
  const [encryptBusy, setEncryptBusy] = useState(false);
  const [decryptBusy, setDecryptBusy] = useState(false);
  const [encryptCancelling, setEncryptCancelling] = useState(false);
  const [encryptionProgress, setEncryptionProgress] = useState<BuildProgressState>(initialProgress);
  const [decryptionProgress, setDecryptionProgress] = useState<BuildProgressState>(initialProgress);
  const [encryptionLogs, setEncryptionLogs] = useState<BuildLogEntry[]>([]);
  const [decryptionLogs, setDecryptionLogs] = useState<BuildLogEntry[]>([]);
  const [decryptionFailures, setDecryptionFailures] = useState<DecryptionFailure[]>([]);
  const [progressNow, setProgressNow] = useState(() => Date.now());
  const logIdRef = useRef(0);
  const taskIdRef = useRef(0);
  const encryptionBackfillVersionRef = useRef(0);
  const decryptionBackfillVersionRef = useRef(0);

  useEffect(() => {
    let active = true;
    const encryptionBackfillVersion = encryptionBackfillVersionRef.current;
    const decryptionBackfillVersion = decryptionBackfillVersionRef.current;
    void Promise.all([window.forwarder.getEncryptionPreferences(), window.forwarder.getDecryptionPreferences()]).then(([encryption, decryption]) => {
      if (!active) return;
      if (encryptionBackfillVersionRef.current === encryptionBackfillVersion) {
        setEncryptionPreferences(encryption);
        setEncryptionInput(encryption.inputDir);
        setEncryptionOutput(encryption.outputDir);
      }
      setLowercaseOutput(encryption.lowercaseOutput);
      if (decryptionBackfillVersionRef.current === decryptionBackfillVersion) {
        setDecryptionPreferences(decryption);
        setDecryptionInput(decryption.inputDir);
        setDecryptionOutput(decryption.outputDir);
      }
    }).catch((cause) => {
      if (active) notifyError(cause, "构建目录配置读取失败");
    });
    return () => { active = false; };
  }, [notifyError]);

  useEffect(() => {
    if (backfillTask === undefined) return;
    if (backfillTask.kind === "encrypt") {
      encryptionBackfillVersionRef.current += 1;
      setTab(backfillTask.kind);
      setEncryptionInput(backfillTask.inputDir);
      setEncryptionOutput(backfillTask.outputDir);
      setEncryptionPreferences((current) => ({ ...current, inputDir: backfillTask.inputDir, outputDir: backfillTask.outputDir }));
      void window.forwarder.saveEncryptionPreferences({ inputDir: backfillTask.inputDir, outputDir: backfillTask.outputDir }).then((result) => {
        if (result.ok && result.preferences !== undefined) setEncryptionPreferences(result.preferences);
      }).catch(() => undefined);
    } else {
      decryptionBackfillVersionRef.current += 1;
      setTab(backfillTask.kind);
      setDecryptionInput(backfillTask.inputDir);
      setDecryptionOutput(backfillTask.outputDir);
      setDecryptionPreferences((current) => ({ ...current, inputDir: backfillTask.inputDir, outputDir: backfillTask.outputDir }));
      void window.forwarder.saveDecryptionPreferences({ inputDir: backfillTask.inputDir, outputDir: backfillTask.outputDir }).then((result) => {
        if (result.ok && result.preferences !== undefined) setDecryptionPreferences(result.preferences);
      }).catch(() => undefined);
    }
    onBackfillApplied();
  }, [backfillTask, onBackfillApplied]);

  useEffect(() => window.forwarder.onEncryptionProgress((progress) => {
    setEncryptionProgress((current) => ({
      ...current,
      phase: progress.phase === "completed" ? "completed" : progress.phase === "scanning" ? "scanning" : "running",
      current: progress.phase === "scanning" ? 0 : progress.current,
      total: progress.total,
      processedFiles: progress.processedFiles,
      skippedFiles: progress.skippedFiles,
      failedFiles: 0,
    }));
    if (progress.phase === "scanning") {
      setEncryptionLogs((current) => current.at(-1)?.message === "正在扫描文件…" ? current : appendLog(current, "info", "正在扫描文件…", ++logIdRef.current));
    } else if (progress.status === "encrypting" && progress.relativePath !== undefined) {
      setEncryptionLogs((current) => appendLog(current, "info", `加密：${progress.relativePath}`, ++logIdRef.current));
    } else if (progress.status === "skipping" && progress.relativePath !== undefined) {
      setEncryptionLogs((current) => appendLog(current, "skip", `跳过未变化：${progress.relativePath}`, ++logIdRef.current));
    } else if (progress.status === "removing" && progress.relativePath !== undefined) {
      setEncryptionLogs((current) => appendLog(current, "warn", `移除：${progress.relativePath}`, ++logIdRef.current));
    }
  }), []);

  useEffect(() => window.forwarder.onDecryptionProgress((progress) => {
    setDecryptionProgress((current) => ({
      ...current,
      phase: progress.phase === "completed" ? "completed" : progress.phase === "scanning" ? "scanning" : "running",
      current: progress.phase === "scanning" ? 0 : progress.current,
      total: progress.total,
      processedFiles: progress.processedFiles,
      skippedFiles: current.skippedFiles,
      failedFiles: progress.failedFiles,
    }));
    if (progress.phase === "scanning") {
      setDecryptionLogs((current) => current.at(-1)?.message === "正在扫描 .d 文件…" ? current : appendLog(current, "info", "正在扫描 .d 文件…", ++logIdRef.current));
    } else if (progress.status === "decrypting" && progress.relativePath !== undefined) {
      setDecryptionLogs((current) => appendLog(current, "info", `解密：${progress.relativePath}`, ++logIdRef.current));
    } else if (progress.status === "failed" && progress.relativePath !== undefined) {
      setDecryptionLogs((current) => appendLog(current, "error", `失败：${progress.relativePath}`, ++logIdRef.current));
    }
  }), []);

  useEffect(() => {
    if (!encryptBusy && !decryptBusy) return;
    setProgressNow(Date.now());
    const timer = window.setInterval(() => setProgressNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [decryptBusy, encryptBusy]);

  const saveEncryptionPath = async (kind: "input" | "output", value: string) => {
    try {
      const directory = parseDirectoryInput(value);
      const result = await window.forwarder.saveEncryptionPreferences(kind === "input" ? { inputDir: directory } : { outputDir: directory });
      if (!result.ok) throw new Error(result.error ?? "加密目录保存失败");
      const next = result.preferences ?? { ...encryptionPreferences, [kind === "input" ? "inputDir" : "outputDir"]: directory };
      setEncryptionPreferences(next);
      setEncryptionInput(next.inputDir);
      setEncryptionOutput(next.outputDir);
    } catch (cause) {
      setEncryptionInput(encryptionPreferences.inputDir);
      setEncryptionOutput(encryptionPreferences.outputDir);
      notifyError(cause, "目录路径无效");
    }
  };

  const saveDecryptionPath = async (kind: "input" | "output", value: string) => {
    try {
      const directory = parseDirectoryInput(value);
      const result = await window.forwarder.saveDecryptionPreferences(kind === "input" ? { inputDir: directory } : { outputDir: directory });
      if (!result.ok) throw new Error(result.error ?? "解密目录保存失败");
      const next = result.preferences ?? { ...decryptionPreferences, [kind === "input" ? "inputDir" : "outputDir"]: directory };
      setDecryptionPreferences(next);
      setDecryptionInput(next.inputDir);
      setDecryptionOutput(next.outputDir);
    } catch (cause) {
      setDecryptionInput(decryptionPreferences.inputDir);
      setDecryptionOutput(decryptionPreferences.outputDir);
      notifyError(cause, "目录路径无效");
    }
  };

  const chooseEncryptionPath = async (kind: "input" | "output") => {
    try {
      const result = await window.forwarder.selectEncryptionDirectory(kind);
      if (result.canceled) return;
      if (!result.ok || result.path === undefined) throw new Error(result.error ?? "选择加密目录失败");
      if (result.preferences !== undefined) {
        setEncryptionPreferences(result.preferences);
        setEncryptionInput(result.preferences.inputDir);
        setEncryptionOutput(result.preferences.outputDir);
      } else if (kind === "input") {
        setEncryptionInput(result.path);
      } else {
        setEncryptionOutput(result.path);
      }
    } catch (cause) {
      notifyError(cause, "选择目录失败");
    }
  };

  const chooseDecryptionPath = async (kind: "input" | "output") => {
    try {
      const result = await window.forwarder.selectDecryptionDirectory(kind);
      if (result.canceled) return;
      if (!result.ok || result.path === undefined) throw new Error(result.error ?? "选择解密目录失败");
      if (result.preferences !== undefined) {
        setDecryptionPreferences(result.preferences);
        setDecryptionInput(result.preferences.inputDir);
        setDecryptionOutput(result.preferences.outputDir);
      } else if (kind === "input") {
        setDecryptionInput(result.path);
      } else {
        setDecryptionOutput(result.path);
      }
    } catch (cause) {
      notifyError(cause, "选择目录失败");
    }
  };

  const updateLowercase = async (checked: boolean) => {
    setLowercaseOutput(checked);
    const result = await window.forwarder.saveEncryptionPreferences({ lowercaseOutput: checked });
    if (!result.ok) {
      setLowercaseOutput(!checked);
      notifyError(result.error ?? "小写输出设置保存失败", "设置保存失败");
      return;
    }
    setEncryptionPreferences((current) => result.preferences ?? { ...current, lowercaseOutput: checked });
  };

  const selectEncryptionMode = (mode: EncryptionMode) => {
    setEncryptionMode(mode);
    writeBuildEncryptionMode(getBuildModeStorage(), mode);
  };

  const startEncryption = async () => {
    if (encryptBusy) return;
    if (encryptionInput === "" || encryptionOutput === "") {
      notify({ kind: "warning", message: "请先选择源目录和输出目录" });
      return;
    }
    const startedAt = Date.now();
    const taskId = `build-${startedAt}-${++taskIdRef.current}`;
    onCreateTask({ id: taskId, kind: "encrypt", mode: encryptionMode, status: "running", inputDir: encryptionInput, outputDir: encryptionOutput, startedAt });
    setEncryptBusy(true);
    setEncryptCancelling(false);
    setEncryptionLogs([{ id: ++logIdRef.current, time: clockTime(startedAt), level: "info", message: `开始${encryptionMode === "incremental" ? "增量" : "全量"}加密任务…` }]);
    setEncryptionProgress({ ...initialProgress, phase: "scanning", startedAt });
    try {
      const result = await window.forwarder.encryptDirectory(encryptionInput, encryptionOutput, encryptionMode, lowercaseOutput);
      const finishedAt = Date.now();
      const total = result.totalFiles ?? 0;
      const processed = result.processedFiles ?? 0;
      const skipped = result.skippedFiles ?? 0;
      const failed = result.missingOutputFiles ?? (result.ok ? 0 : 1);
      if (result.canceled) {
        setEncryptionProgress({ phase: "canceled", current: Math.min(total, processed + skipped), total, processedFiles: processed, skippedFiles: skipped, failedFiles: 0, startedAt, finishedAt });
        setEncryptionLogs((current) => appendLog(current, "warn", `已取消：处理 ${processed} 个，跳过 ${skipped} 个（共 ${total} 个）。`, ++logIdRef.current));
        onUpdateTask(taskId, { status: "canceled", finishedAt, totalFiles: total, processedFiles: processed, failedFiles: 0 });
        return;
      }
      if (!result.ok) {
        setEncryptionProgress({ phase: "error", current: processed, total, processedFiles: processed, skippedFiles: skipped, failedFiles: failed, startedAt, finishedAt });
        setEncryptionLogs((current) => appendLog(current, "error", result.error ?? "加密任务失败", ++logIdRef.current));
        onUpdateTask(taskId, { status: "error", finishedAt, totalFiles: total, processedFiles: processed, failedFiles: failed, error: result.error });
        notifyError(result.error ?? "加密失败", "加密失败");
        return;
      }
      setEncryptionProgress({ phase: "completed", current: total, total, processedFiles: processed, skippedFiles: skipped, failedFiles: failed, startedAt, finishedAt });
      setEncryptionLogs((current) => appendLog(current, missingTone(failed), `完成：处理 ${processed} 个，跳过 ${skipped} 个${failed > 0 ? `，输出缺失 ${failed} 个` : ""}（共 ${total} 个） ${shortTime(finishedAt)}`, ++logIdRef.current));
      onUpdateTask(taskId, { status: "success", finishedAt, totalFiles: total, processedFiles: processed, failedFiles: failed });
      notify({ kind: failed > 0 ? "warning" : "success", title: failed > 0 ? "构建完成，有文件缺失" : "加密完成", message: failed > 0 ? `已处理 ${processed} 个文件，${failed} 个输出缺失；可执行全量加密补全。` : `已加密 ${processed} 个文件，跳过 ${skipped} 个。` });
    } catch (cause) {
      const finishedAt = Date.now();
      setEncryptionProgress((current) => ({ ...current, phase: "error", finishedAt }));
      setEncryptionLogs((current) => appendLog(current, "error", cause instanceof Error ? cause.message : String(cause), ++logIdRef.current));
      onUpdateTask(taskId, { status: "error", finishedAt, error: cause instanceof Error ? cause.message : String(cause) });
      notifyError(cause, "加密失败");
    } finally {
      setEncryptBusy(false);
      setEncryptCancelling(false);
    }
  };

  const cancelEncryption = async () => {
    if (!encryptBusy || encryptCancelling) return;
    setEncryptCancelling(true);
    setEncryptionLogs((current) => appendLog(current, "warn", "正在取消加密任务…", ++logIdRef.current));
    try {
      const result = await window.forwarder.cancelEncryption();
      if (!result.ok) throw new Error(result.error ?? "取消加密失败");
      notify({ kind: "success", message: "已请求取消加密任务" });
    } catch (cause) {
      setEncryptCancelling(false);
      notifyError(cause, "取消加密失败");
    }
  };

  const startDecryption = async () => {
    if (decryptBusy) return;
    if (decryptionInput === "" || decryptionOutput === "") {
      notify({ kind: "warning", message: "请先选择待解密目录和还原目录" });
      return;
    }
    const startedAt = Date.now();
    const taskId = `build-${startedAt}-${++taskIdRef.current}`;
    onCreateTask({ id: taskId, kind: "decrypt", mode: "restore", status: "running", inputDir: decryptionInput, outputDir: decryptionOutput, startedAt });
    setDecryptBusy(true);
    setDecryptionFailures([]);
    setDecryptionLogs([{ id: ++logIdRef.current, time: clockTime(startedAt), level: "info", message: "开始解密还原任务…" }]);
    setDecryptionProgress({ ...initialProgress, phase: "scanning", startedAt });
    try {
      const result = await window.forwarder.decryptDirectory(decryptionInput, decryptionOutput);
      const finishedAt = Date.now();
      const total = result.totalFiles ?? 0;
      const processed = result.processedFiles ?? 0;
      const skipped = result.skippedFiles ?? 0;
      const failed = result.failedFiles ?? 0;
      if (!result.ok) {
        setDecryptionProgress({ phase: "error", current: processed, total, processedFiles: processed, skippedFiles: skipped, failedFiles: failed || 1, startedAt, finishedAt });
        setDecryptionLogs((current) => appendLog(current, "error", result.error ?? "解密任务失败", ++logIdRef.current));
        onUpdateTask(taskId, { status: "error", finishedAt, totalFiles: total, processedFiles: processed, failedFiles: failed || 1, error: result.error });
        notifyError(result.error ?? "解密失败", "解密失败");
        return;
      }
      setDecryptionFailures(result.failures ?? []);
      setDecryptionProgress({ phase: "completed", current: total, total, processedFiles: processed, skippedFiles: skipped, failedFiles: failed, startedAt, finishedAt });
      setDecryptionLogs((current) => {
        const withResult = (result.logs ?? []).reduce((logs, line) => appendLog(logs, "info", line, ++logIdRef.current), current);
        return appendLog(withResult, failed > 0 ? "warn" : "ok", `完成：还原 ${processed} 个，失败 ${failed} 个，跳过 ${skipped} 个（共 ${total} 个） ${shortTime(finishedAt)}`, ++logIdRef.current);
      });
      onUpdateTask(taskId, { status: "success", finishedAt, totalFiles: total, processedFiles: processed, failedFiles: failed });
      if (failed > 0) notify({ kind: "warning", title: "部分文件未还原", message: `成功 ${processed} 个，失败 ${failed} 个，请查看构建日志。` });
      else notify({ kind: "success", message: `已还原 ${processed} 个文件${(result.hashVerifiedFiles ?? 0) > 0 ? `，${result.hashVerifiedFiles} 个通过 SHA-256 校验` : ""}` });
    } catch (cause) {
      const finishedAt = Date.now();
      setDecryptionProgress((current) => ({ ...current, phase: "error", finishedAt }));
      setDecryptionLogs((current) => appendLog(current, "error", cause instanceof Error ? cause.message : String(cause), ++logIdRef.current));
      onUpdateTask(taskId, { status: "error", finishedAt, error: cause instanceof Error ? cause.message : String(cause) });
      notifyError(cause, "解密失败");
    } finally {
      setDecryptBusy(false);
    }
  };

  const activeProgress = tab === "encrypt" ? encryptionProgress : decryptionProgress;
  const activeBusy = tab === "encrypt" ? encryptBusy : decryptBusy;
  const activeLogs = tab === "encrypt" ? encryptionLogs : decryptionLogs;
  const percent = progressPercent(activeProgress);
  const processedActivity = activeProgress.processedFiles + activeProgress.skippedFiles + activeProgress.failedFiles;
  const titleName = tab === "encrypt" ? pathName(encryptionInput, "资源目录") : pathName(decryptionInput, "解密目录");
  const modeLabel = tab === "encrypt" ? encryptionMode === "incremental" ? "增量加密" : "全量加密" : "解密还原";
  const canStart = tab === "encrypt" ? encryptionInput !== "" && encryptionOutput !== "" && !encryptBusy : decryptionInput !== "" && decryptionOutput !== "" && !decryptBusy;
  const startBuild = () => { if (tab === "encrypt") void startEncryption(); else void startDecryption(); };
  const activeTone = progressTone(activeProgress, activeBusy);
  const elapsedSeconds = activeProgress.startedAt === undefined ? 0 : Math.max(0, (progressNow - activeProgress.startedAt) / 1000);
  const estimatedRemainingSeconds = activeProgress.current > 0 && activeProgress.total > activeProgress.current
    ? Math.ceil((elapsedSeconds * (activeProgress.total - activeProgress.current)) / activeProgress.current)
    : 0;
  const remainingTime = activeProgress.phase === "completed"
    ? "0 秒"
    : activeProgress.phase === "scanning" || (activeProgress.phase === "running" && activeProgress.current <= 0)
      ? "计算中…"
      : activeProgress.phase === "running"
        ? formatBuildRemainingTime(estimatedRemainingSeconds)
        : "—";
  const summary = activeProgress.total > 0 ? `当前任务 ${formatCount(activeProgress.total)} 个文件 · 已处理 ${formatCount(processedActivity)} 个` : "目录和进度在后台保留，可安全切换页面";
  const timing = activeProgress.startedAt === undefined
    ? tab === "encrypt" ? "选择源目录和输出目录后开始构建" : "选择 .d 目录和还原目录后开始构建"
    : activeProgress.finishedAt === undefined
      ? `开始于 ${shortTime(activeProgress.startedAt)} · ${phaseCopy(tab, activeProgress, activeBusy)}`
      : `开始于 ${shortTime(activeProgress.startedAt)} · 结束于 ${shortTime(activeProgress.finishedAt)}`;
  const encryptionHistory = useMemo(() => [...new Set([encryptionInput, ...encryptionPreferences.inputHistory].filter(Boolean))], [encryptionInput, encryptionPreferences.inputHistory]);
  const encryptionOutputHistory = useMemo(() => [...new Set([encryptionOutput, ...encryptionPreferences.outputHistory].filter(Boolean))], [encryptionOutput, encryptionPreferences.outputHistory]);
  const decryptionHistory = useMemo(() => [...new Set([decryptionInput, ...decryptionPreferences.inputHistory].filter(Boolean))], [decryptionInput, decryptionPreferences.inputHistory]);
  const decryptionOutputHistory = useMemo(() => [...new Set([decryptionOutput, ...decryptionPreferences.outputHistory].filter(Boolean))], [decryptionOutput, decryptionPreferences.outputHistory]);

  return <section className="lf-view-body">
    <header className="lf-page-head">
      <div>
        <p className="lf-page-eyebrow">Build · Resources</p>
        <div className="lf-page-title-line"><h1>资源构建</h1><span className="lf-live-pill"><i />任务全局运行</span></div>
        <p className="lf-page-sub">加密与解密共享同一套目录、进度和日志界面；构建期间可以继续切换环境或调试请求。</p>
      </div>
      <div className="lf-page-actions">
        <button className="lf-btn" type="button" onClick={onOpenJobs}>任务记录</button>
        <button className="lf-btn primary" type="button" disabled={!canStart} onClick={startBuild}>{activeBusy ? "构建中…" : "开始构建"}</button>
      </div>
    </header>

    <div className="lf-build-tabs-row">
      <div className="lf-segmented lf-build-switch" role="group" aria-label="构建方向">
        <button className={tab === "encrypt" ? "active" : ""} type="button" onClick={() => setTab("encrypt")}>加密输出</button>
        <button className={tab === "decrypt" ? "active" : ""} type="button" onClick={() => setTab("decrypt")}>解密还原</button>
      </div>
      <span className="lf-faint lf-small">{summary}</span>
    </div>

    <div className="lf-build-grid">
      <section className="lf-panel lf-build-card">
        <h3>构建设置</h3>
        {tab === "encrypt" ? <>
          <div className="lf-build-field">
            <label htmlFor="build-encryption-input">源目录</label>
            <div className="lf-build-path"><input id="build-encryption-input" className="lf-control mono" list="build-encryption-input-history" value={encryptionInput} placeholder="选择需要加密的资源目录" disabled={encryptBusy} onChange={(event) => setEncryptionInput(event.target.value)} onBlur={() => { if (encryptionInput !== encryptionPreferences.inputDir) void saveEncryptionPath("input", encryptionInput); }} /><datalist id="build-encryption-input-history">{encryptionHistory.map((directory) => <option value={directory} key={directory} />)}</datalist><button className="lf-btn small" type="button" disabled={encryptBusy} onClick={() => void chooseEncryptionPath("input")}>选择</button></div>
          </div>
          <div className="lf-build-field">
            <label htmlFor="build-encryption-output">输出目录</label>
            <div className="lf-build-path"><input id="build-encryption-output" className="lf-control mono" list="build-encryption-output-history" value={encryptionOutput} placeholder="选择 .d 输出目录" disabled={encryptBusy} onChange={(event) => setEncryptionOutput(event.target.value)} onBlur={() => { if (encryptionOutput !== encryptionPreferences.outputDir) void saveEncryptionPath("output", encryptionOutput); }} /><datalist id="build-encryption-output-history">{encryptionOutputHistory.map((directory) => <option value={directory} key={directory} />)}</datalist><button className="lf-btn small" type="button" disabled={encryptBusy} onClick={() => void chooseEncryptionPath("output")}>选择</button></div>
          </div>
          <div className="lf-build-mode-grid">
            <button className={`lf-build-mode ${encryptionMode === "full" ? "active" : ""}`} type="button" disabled={encryptBusy} onClick={() => selectEncryptionMode("full")}><strong>全量加密</strong><span>重新处理全部文件</span></button>
            <button className={`lf-build-mode ${encryptionMode === "incremental" ? "active" : ""}`} type="button" disabled={encryptBusy} onClick={() => selectEncryptionMode("incremental")}><strong>增量加密</strong><span>跳过未变化的文件</span></button>
          </div>
          <div className="lf-build-option-row"><button className={`lf-switch ${lowercaseOutput ? "on" : ""}`} type="button" aria-label="小写文件输出" aria-pressed={lowercaseOutput} disabled={encryptBusy} onClick={() => void updateLowercase(!lowercaseOutput)} /><span>小写文件输出</span><span className="lf-faint">目录和文件统一转小写</span></div>
        </> : <>
          <div className="lf-build-field">
            <label htmlFor="build-decryption-input">待解密目录</label>
            <div className="lf-build-path"><input id="build-decryption-input" className="lf-control mono" list="build-decryption-input-history" value={decryptionInput} placeholder="选择包含 .d 文件的目录" disabled={decryptBusy} onChange={(event) => setDecryptionInput(event.target.value)} onBlur={() => { if (decryptionInput !== decryptionPreferences.inputDir) void saveDecryptionPath("input", decryptionInput); }} /><datalist id="build-decryption-input-history">{decryptionHistory.map((directory) => <option value={directory} key={directory} />)}</datalist><button className="lf-btn small" type="button" disabled={decryptBusy} onClick={() => void chooseDecryptionPath("input")}>选择</button></div>
          </div>
          <div className="lf-build-field">
            <label htmlFor="build-decryption-output">还原目录</label>
            <div className="lf-build-path"><input id="build-decryption-output" className="lf-control mono" list="build-decryption-output-history" value={decryptionOutput} placeholder="选择原始资源还原目录" disabled={decryptBusy} onChange={(event) => setDecryptionOutput(event.target.value)} onBlur={() => { if (decryptionOutput !== decryptionPreferences.outputDir) void saveDecryptionPath("output", decryptionOutput); }} /><datalist id="build-decryption-output-history">{decryptionOutputHistory.map((directory) => <option value={directory} key={directory} />)}</datalist><button className="lf-btn small" type="button" disabled={decryptBusy} onClick={() => void chooseDecryptionPath("output")}>选择</button></div>
          </div>
          <div className="lf-build-mode-grid lf-build-mode-grid-static">
            <div className="lf-build-mode active"><strong>同结构还原</strong><span>保留 .d 目录层级</span></div>
            <div className="lf-build-mode active"><strong>完整性校验</strong><span>CRC32 · SHA-256</span></div>
          </div>
          <div className="lf-build-option-row"><span className="lf-status-badge success">自动校验</span><span>输出目录中的同名文件会被直接替换</span><span className="lf-faint">本地处理</span></div>
        </>}
      </section>

      <section className="lf-panel lf-build-card lf-build-progress-card" aria-live="polite">
        <div className="lf-build-progress-head">
          <div><strong>{modeLabel} · {titleName}</strong><span>{timing}</span></div>
          <b>{percent}%</b>
        </div>
        <div className="lf-build-progress-track" role="progressbar" aria-label={`${modeLabel}进度`} aria-valuemin={0} aria-valuemax={activeProgress.total} aria-valuenow={activeProgress.current}><span style={{ width: `${percent}%` }} /></div>
        <div className="lf-build-stats">
          <div><span>总文件</span><strong>{formatCount(activeProgress.total)}</strong></div>
          <div><span>{tab === "encrypt" ? "已加密" : "已还原"}</span><strong>{formatCount(activeProgress.processedFiles)}</strong></div>
          <div><span>跳过</span><strong>{formatCount(activeProgress.skippedFiles)}</strong></div>
          <div><span>剩余时间</span><strong>{remainingTime}</strong></div>
        </div>
        <div className="lf-build-progress-foot">
          <span><span className={`lf-status-dot ${activeTone}`} />{phaseCopy(tab, activeProgress, activeBusy)} · 任务在后台运行，可安全切换页面</span>
          {tab === "encrypt" && encryptBusy
            ? <button className="lf-btn small danger" type="button" disabled={encryptCancelling} onClick={() => void cancelEncryption()}>{encryptCancelling ? "正在取消…" : "取消任务"}</button>
            : activeProgress.phase === "completed" || activeProgress.phase === "canceled" || activeProgress.phase === "error"
              ? <button className="lf-btn small" type="button" onClick={onOpenJobs}>查看任务记录</button>
              : null}
        </div>
        {tab === "decrypt" && decryptionFailures.length > 0 && <div className="lf-build-failures"><span>{decryptionFailures.length} 个文件未还原</span><details><summary>查看失败文件</summary>{decryptionFailures.map((failure) => <div key={failure.relativePath}><code>{failure.relativePath}</code><span>{failure.error}</span></div>)}</details></div>}
      </section>
    </div>

    <section className="lf-panel lf-build-log">
      <div className="lf-panel-head"><div><h3>构建日志</h3><span>实时输出</span></div><span>{formatCount(processedActivity)} / {formatCount(activeProgress.total)}</span></div>
      {activeLogs.length === 0
        ? <div className="lf-build-log-empty">开始构建后，文件处理结果会实时显示在这里。</div>
        : <div className="lf-build-log-list" role="log" aria-live="polite">{activeLogs.map((entry) => <div className="lf-build-log-line" key={entry.id}><time>{entry.time}</time><span className={`lf-build-log-level ${entry.level}`}>{logLevelLabels[entry.level]}</span><span>{entry.message}</span></div>)}</div>}
    </section>
  </section>;
}

function missingTone(failed: number): BuildLogLevel {
  return failed > 0 ? "warn" : "ok";
}
