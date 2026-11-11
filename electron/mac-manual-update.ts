import { createHash } from "node:crypto";
import { open, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { UpdateAdapter } from "./update-service";
import type { UpdateInfoSnapshot, UpdateProgressSnapshot } from "../src/shared/contracts";

export type MacUpdateArchitecture = "x64" | "arm64";
export type ManualUpdateFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface MacUpdateFile {
  arch: MacUpdateArchitecture;
  name: string;
  sha512: string;
  size: number;
}

export interface MacUpdateManifest {
  version: string;
  releaseDate?: string;
  releaseNotes?: string;
  files: MacUpdateFile[];
}

export interface MacManualUpdateAdapterOptions {
  currentVersion: string;
  architecture: MacUpdateArchitecture;
  manifestUrl: string;
  downloadBaseUrl: string;
  downloadDirectory: string;
  fetchImpl?: ManualUpdateFetch;
  openPath: (filePath: string) => Promise<string>;
  now?: () => number;
}

const PROGRESS_INTERVAL_MS = 150;
const MANIFEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

export function createMacUpdateUrls(owner: string, repo: string): { manifestUrl: string; downloadBaseUrl: string } {
  const base = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest/download`;
  return {
    manifestUrl: `${base}/mac-update.json`,
    downloadBaseUrl: `${base}/`,
  };
}

export function compareVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "版本号格式无效");
  }
  for (let index = 0; index < 3; index += 1) {
    const difference = leftVersion.core[index] - rightVersion.core[index];
    if (difference !== 0) return Math.sign(difference);
  }
  if (leftVersion.prerelease === rightVersion.prerelease) return 0;
  if (leftVersion.prerelease === undefined) return 1;
  if (rightVersion.prerelease === undefined) return -1;
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

export function parseMacUpdateManifest(value: unknown): MacUpdateManifest {
  if (!isRecord(value)) throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新元数据格式无效");
  if (typeof value.version !== "string" || !isValidVersion(value.version)) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新元数据版本号无效");
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新元数据缺少安装包");
  }
  const files = value.files.map((entry) => parseMacUpdateFile(entry));
  const manifest: MacUpdateManifest = { version: value.version, files };
  if (typeof value.releaseDate === "string" && value.releaseDate.length > 0) manifest.releaseDate = value.releaseDate;
  if (typeof value.releaseNotes === "string" && value.releaseNotes.length > 0) manifest.releaseNotes = value.releaseNotes;
  return manifest;
}

export function createMacManualUpdateAdapter(options: MacManualUpdateAdapterOptions): UpdateAdapter {
  const fetchImpl: ManualUpdateFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const checkingListeners = new Set<() => void>();
  const availableListeners = new Set<(info: UpdateInfoSnapshot) => void>();
  const notAvailableListeners = new Set<() => void>();
  const progressListeners = new Set<(progress: UpdateProgressSnapshot) => void>();
  const downloadedListeners = new Set<(info: UpdateInfoSnapshot) => void>();
  const errorListeners = new Set<(error: unknown) => void>();
  let pendingUpdate: { info: UpdateInfoSnapshot; file: MacUpdateFile } | undefined;
  let downloadedPath: string | undefined;

  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    onCheckingForUpdate(listener) {
      return addListener(checkingListeners, listener);
    },
    onUpdateAvailable(listener) {
      return addListener(availableListeners, listener);
    },
    onUpdateNotAvailable(listener) {
      return addListener(notAvailableListeners, listener);
    },
    onDownloadProgress(listener) {
      return addListener(progressListeners, listener);
    },
    onUpdateDownloaded(listener) {
      return addListener(downloadedListeners, listener);
    },
    onError(listener) {
      return addListener(errorListeners, listener);
    },
    async checkForUpdates() {
      emit(checkingListeners);
      try {
        const response = await fetchImpl(options.manifestUrl, {
          headers: { "User-Agent": `Local-Forwarder/${options.currentVersion}` },
          redirect: "follow",
          signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          if (response.status === 404) {
            pendingUpdate = undefined;
            downloadedPath = undefined;
            emit(notAvailableListeners);
            return {};
          }
          const code = response.status === 404 ? "ERR_MANUAL_UPDATE_NOT_FOUND" : "ERR_MANUAL_UPDATE_MANIFEST";
          throw Object.assign(manualUpdateError(code, "无法获取 Mac 更新元数据"), {
            statusCode: response.status,
          });
        }
        const manifest = parseMacUpdateManifest(await response.json());
        const file = manifest.files.find((entry) => entry.arch === options.architecture);
        if (file === undefined) {
          throw manualUpdateError("ERR_MANUAL_UPDATE_ARCH", "当前 Mac 架构没有可用安装包");
        }
        const info: UpdateInfoSnapshot = {
          version: manifest.version,
          ...(manifest.releaseDate === undefined ? {} : { releaseDate: manifest.releaseDate }),
          ...(manifest.releaseNotes === undefined ? {} : { releaseNotes: manifest.releaseNotes }),
        };
        if (compareVersions(manifest.version, options.currentVersion) > 0) {
          pendingUpdate = { info, file };
          downloadedPath = undefined;
          emit(availableListeners, info);
        } else {
          pendingUpdate = undefined;
          downloadedPath = undefined;
          emit(notAvailableListeners);
        }
        return {};
      } catch (error) {
        emit(errorListeners, error);
        throw error;
      }
    },
    async downloadUpdate() {
      if (pendingUpdate === undefined) {
        throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "没有可下载的 Mac 更新");
      }
      const { info, file } = pendingUpdate;
      await mkdir(options.downloadDirectory, { recursive: true });
      const destination = path.join(options.downloadDirectory, file.name);
      const temporary = `${destination}.part`;
      try {
        await downloadToFile({
          url: `${options.downloadBaseUrl}${encodeURIComponent(file.name)}`,
          destination: temporary,
          expected: file,
          fetchImpl,
          now,
          onProgress: (progress) => emit(progressListeners, progress),
        });
        await rm(destination, { force: true });
        await rename(temporary, destination);
        downloadedPath = destination;
        emit(downloadedListeners, info);
        return destination;
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        emit(errorListeners, error);
        throw error;
      }
    },
    async openDownloadedUpdate() {
      if (downloadedPath === undefined) {
        throw manualUpdateError("ERR_MANUAL_UPDATE_OPEN", "安装包尚未下载");
      }
      const errorMessage = await options.openPath(downloadedPath);
      if (errorMessage.length > 0) {
        throw manualUpdateError("ERR_MANUAL_UPDATE_OPEN", errorMessage);
      }
      return downloadedPath;
    },
    quitAndInstall() {
      throw manualUpdateError("ERR_MANUAL_UPDATE_OPEN", "Mac 版本需要手动安装");
    },
  };
}

function parseMacUpdateFile(value: unknown): MacUpdateFile {
  if (!isRecord(value)) throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新安装包信息无效");
  if (value.arch !== "x64" && value.arch !== "arm64") {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新安装包架构无效");
  }
  if (typeof value.name !== "string" || path.basename(value.name) !== value.name || !value.name.endsWith(".dmg")) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新安装包文件名无效");
  }
  if (typeof value.sha512 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.sha512)) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新安装包缺少有效 SHA-512");
  }
  if (typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size <= 0) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_MANIFEST", "更新安装包大小无效");
  }
  return { arch: value.arch, name: value.name, sha512: value.sha512, size: value.size };
}

interface DownloadToFileOptions {
  url: string;
  destination: string;
  expected: MacUpdateFile;
  fetchImpl: ManualUpdateFetch;
  now: () => number;
  onProgress: (progress: UpdateProgressSnapshot) => void;
}

async function downloadToFile(options: DownloadToFileOptions): Promise<void> {
  const response = await options.fetchImpl(options.url, {
    headers: { "User-Agent": "Local-Forwarder" },
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw Object.assign(manualUpdateError("ERR_MANUAL_UPDATE_DOWNLOAD", "安装包下载失败"), {
      statusCode: response.status,
    });
  }
  if (response.body === null) {
    throw manualUpdateError("ERR_MANUAL_UPDATE_DOWNLOAD", "安装包响应为空");
  }

  const totalHeader = Number(response.headers.get("content-length"));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : options.expected.size;
  const hash = createHash("sha512");
  const file = await open(options.destination, "w");
  const reader = response.body.getReader();
  const startedAt = options.now();
  let transferred = 0;
  let lastProgressAt = startedAt;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      await file.write(chunk);
      hash.update(chunk);
      transferred += chunk.length;
      const timestamp = options.now();
      if (timestamp - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = timestamp;
        options.onProgress(progressSnapshot(transferred, total, startedAt, timestamp));
      }
    }
    options.onProgress(progressSnapshot(transferred, total, startedAt, options.now()));
    const digest = hash.digest("base64");
    if (digest !== options.expected.sha512) {
      throw manualUpdateError("ERR_MANUAL_UPDATE_CHECKSUM", "安装包 SHA-512 校验失败");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    await file.close();
  }
}

function progressSnapshot(transferred: number, total: number, startedAt: number, timestamp: number): UpdateProgressSnapshot {
  const elapsedSeconds = Math.max((timestamp - startedAt) / 1000, 0.001);
  return {
    percent: total > 0 ? Math.min(100, (transferred / total) * 100) : 0,
    transferred,
    total,
    bytesPerSecond: transferred / elapsedSeconds,
  };
}

function parseVersion(value: string): { core: [number, number, number]; prerelease?: string } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value.trim());
  if (match === null) return undefined;
  const core: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return match[4] === undefined ? { core } : { core, prerelease: match[4] };
}

function isValidVersion(value: string): boolean {
  return parseVersion(value) !== undefined;
}

function comparePrerelease(left: string, right: string): number {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return Math.sign(leftNumber - rightNumber);
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function manualUpdateError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function addListener<T>(listeners: Set<T>, listener: T): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit<T>(listeners: Set<T>, value?: T extends (value: infer P) => void ? P : never): void {
  for (const listener of listeners) {
    if (value === undefined) (listener as () => void)();
    else (listener as (next: typeof value) => void)(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
