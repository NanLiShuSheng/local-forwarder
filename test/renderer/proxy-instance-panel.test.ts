import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("overview renders proxy instance management actions", async () => {
  const panel = await readFile("src/renderer/components/ProxyInstancePanel.tsx", "utf8");
  const app = await readFile("src/renderer/App.tsx", "utf8");
  const runtime = await readFile("src/renderer/components/RuntimePanel.tsx", "utf8");
  assert.match(app, /ProxyInstancePanel/);
  assert.match(app, /listProxyInstances/);
  assert.match(app, /selectProxyInstance/);
  assert.match(app, /createProxyInstance/);
  assert.match(app, /duplicateProxyInstance/);
  assert.match(panel, /新增代理/);
  assert.match(panel, /复制当前代理/);
  assert.match(panel, /onStart/);
  assert.match(runtime, /代理状态/);
});

test("original request and encryption navigation remain available", async () => {
  const app = await readFile("src/renderer/App.tsx", "utf8");
  assert.match(app, /label: "请求"/);
  assert.match(app, /label: "加密"/);
  assert.match(app, /onEncryptDirectory/);
  assert.match(app, /onSendRequest/);
});
