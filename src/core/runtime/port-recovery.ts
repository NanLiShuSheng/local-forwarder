import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AUTO_RECOVERY_PORT_MIN = 8080;
const AUTO_RECOVERY_PORT_MAX = 8089;
const DEFAULT_TERM_GRACE_MS = 1000;
const DEFAULT_KILL_GRACE_MS = 1000;
const DEFAULT_POLL_INTERVAL_MS = 50;

export interface PortRecoveryDependencies {
  platform?: NodeJS.Platform;
  listListeningProcessIds: (port: number) => Promise<number[]>;
  sendSignal: (pid: number, signal: NodeJS.Signals) => void;
  terminateProcess?: (pid: number, force: boolean) => Promise<void>;
  sleep: (milliseconds: number) => Promise<void>;
  termGraceMs?: number;
  killGraceMs?: number;
  pollIntervalMs?: number;
}

function isProcessMissing(error: unknown): boolean {
  return (error as { code?: string | number }).code === "ESRCH";
}

async function listListeningProcessIds(port: number): Promise<number[]> {
  if (process.platform === "win32") return listWindowsListeningProcessIds(port);
  return listMacListeningProcessIds(port);
}

async function listMacListeningProcessIds(port: number): Promise<number[]> {
  try {
    const result = await execFileAsync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { maxBuffer: 64 * 1024 });
    return [...new Set(result.stdout.split(/\s+/).map((value) => Number(value)).filter((pid) => Number.isInteger(pid) && pid > 0))];
  } catch (error) {
    if ((error as { code?: string | number }).code === 1) return [];
    throw error;
  }
}

export function parseWindowsListeningProcessIds(output: string, port: number): number[] {
  const processIds: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0].toUpperCase() !== "TCP" || fields[3].toUpperCase() !== "LISTENING") continue;
    const localPort = Number(fields[1].match(/:(\d+)$/)?.[1]);
    const pid = Number(fields[4]);
    if (localPort === port && Number.isInteger(pid) && pid > 0) processIds.push(pid);
  }
  return [...new Set(processIds)];
}

async function listWindowsListeningProcessIds(port: number): Promise<number[]> {
  const result = await execFileAsync("netstat", ["-ano", "-p", "tcp"], { maxBuffer: 256 * 1024, windowsHide: true });
  return parseWindowsListeningProcessIds(result.stdout, port);
}

async function terminateWindowsProcess(pid: number, force: boolean): Promise<void> {
  const args = ["/PID", String(pid), "/T"];
  if (force) args.push("/F");
  try {
    await execFileAsync("taskkill", args, { maxBuffer: 64 * 1024, windowsHide: true });
  } catch (error) {
    if (!isWindowsProcessMissing(error)) throw error;
  }
}

function isWindowsProcessMissing(error: unknown): boolean {
  const typedError = error as { code?: string | number; stderr?: string; stdout?: string };
  if (typedError.code === 128) return true;
  if (typedError.code !== 1) return false;
  return /no running instance|not found|does not exist|not running/i.test(`${typedError.stderr ?? ""}\n${typedError.stdout ?? ""}`);
}

const defaultDependencies: PortRecoveryDependencies = {
  platform: process.platform,
  listListeningProcessIds,
  sendSignal: (pid, signal) => process.kill(pid, signal),
  terminateProcess: terminateWindowsProcess,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export function isAutoRecoverablePort(port: number): boolean {
  return Number.isInteger(port) && port >= AUTO_RECOVERY_PORT_MIN && port <= AUTO_RECOVERY_PORT_MAX;
}

export async function recoverOccupiedPort(port: number, overrides: Partial<PortRecoveryDependencies> = {}): Promise<void> {
  if (!isAutoRecoverablePort(port)) return;
  const dependencies = { ...defaultDependencies, ...overrides };
  const platform = dependencies.platform ?? process.platform;
  const terminateProcess = dependencies.terminateProcess ?? terminateWindowsProcess;
  const termGraceMs = dependencies.termGraceMs ?? DEFAULT_TERM_GRACE_MS;
  const killGraceMs = dependencies.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const pollIntervalMs = dependencies.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const listedPids = [...new Set(await dependencies.listListeningProcessIds(port))].filter((pid) => pid !== process.pid && Number.isInteger(pid) && pid > 0);
  if (listedPids.length === 0) return;

  for (const pid of listedPids) {
    try {
      if (platform === "win32") {
        await terminateProcess(pid, false);
      } else {
        dependencies.sendSignal(pid, "SIGTERM");
      }
    } catch (error) {
      if (!isProcessMissing(error) && !(platform === "win32" && isWindowsProcessMissing(error))) throw error;
    }
  }
  if (await waitForPortRelease(port, dependencies, termGraceMs, pollIntervalMs)) return;

  for (const pid of listedPids) {
    try {
      if (platform === "win32") {
        await terminateProcess(pid, true);
      } else {
        dependencies.sendSignal(pid, "SIGKILL");
      }
    } catch (error) {
      if (!isProcessMissing(error) && !(platform === "win32" && isWindowsProcessMissing(error))) throw error;
    }
  }
  if (await waitForPortRelease(port, dependencies, killGraceMs, pollIntervalMs)) return;
  throw new Error(`could not release port ${port}`);
}

async function waitForPortRelease(port: number, dependencies: PortRecoveryDependencies, timeoutMs: number, pollIntervalMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    if ((await dependencies.listListeningProcessIds(port)).length === 0) return true;
    if (Date.now() >= deadline) return false;
    await dependencies.sleep(Math.min(Math.max(0, pollIntervalMs), deadline - Date.now()));
  } while (true);
}
