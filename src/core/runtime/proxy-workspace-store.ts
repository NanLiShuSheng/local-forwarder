import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig, ProxyWorkspace } from "../../shared/contracts";
import { isValidProxyWorkspace } from "../../shared/validation";
import { createDefaultWorkspace } from "../config/model";

function cloneWorkspace(workspace: ProxyWorkspace): ProxyWorkspace {
  return JSON.parse(JSON.stringify(workspace)) as ProxyWorkspace;
}

export class ProxyWorkspaceStore {
  public constructor(private readonly filePath: string) {}

  public async load(fallback: () => Promise<AppConfig>): Promise<ProxyWorkspace> {
    let text: string;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const migrated = createDefaultWorkspace(await fallback());
      await this.save(migrated);
      return cloneWorkspace(migrated);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error("Invalid proxy workspace", { cause: error });
    }
    if (!isValidProxyWorkspace(parsed)) throw new Error("Invalid proxy workspace");
    return cloneWorkspace(parsed);
  }

  public async save(workspace: ProxyWorkspace): Promise<void> {
    if (!isValidProxyWorkspace(workspace)) throw new Error("Invalid proxy workspace");
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(workspace, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporaryPath, this.filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
