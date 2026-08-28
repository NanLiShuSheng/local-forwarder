import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultConfig } from "../../../src/core/config/model";
import { ProxyWorkspaceStore } from "../../../src/core/runtime/proxy-workspace-store";
import type { ProxyWorkspace } from "../../../src/shared/contracts";

test("migrates a legacy config into a default proxy instance", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proxy-workspace-") );
  const workspacePath = path.join(directory, "instances.json");
  const config = createDefaultConfig();
  config.server.port = 8080;
  const store = new ProxyWorkspaceStore(workspacePath);

  const workspace = await store.load(async () => config);

  assert.equal(workspace.selectedInstanceId, "default");
  assert.deepEqual(workspace.instances.map((instance) => instance.name), ["默认代理"]);
  assert.equal(workspace.instances[0]?.config.server.port, 8080);
  assert.equal((await readFile(workspacePath, "utf8")).includes("默认代理"), true);
});

test("saves and reloads multiple proxy instances", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proxy-workspace-") );
  const store = new ProxyWorkspaceStore(path.join(directory, "instances.json"));
  const first = createDefaultConfig();
  const second = createDefaultConfig();
  second.server.port = 8081;
  const workspace: ProxyWorkspace = {
    version: 1,
    selectedInstanceId: "second",
    instances: [
      { id: "first", name: "行情代理", config: first },
      { id: "second", name: "业务办理代理", config: second },
    ],
  };

  await store.save(workspace);
  const loaded = await store.load(async () => { throw new Error("fallback should not run"); });

  assert.deepEqual(loaded, workspace);
});

test("rejects an invalid workspace file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "proxy-workspace-") );
  const workspacePath = path.join(directory, "instances.json");
  await writeFile(workspacePath, JSON.stringify({ version: 1, selectedInstanceId: "missing", instances: [] }), "utf8");
  const store = new ProxyWorkspaceStore(workspacePath);

  await assert.rejects(() => store.load(async () => createDefaultConfig()), /Invalid proxy workspace/);
});
