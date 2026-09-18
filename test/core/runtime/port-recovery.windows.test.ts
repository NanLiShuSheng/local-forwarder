import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";
import { recoverOccupiedPort } from "../../../src/core/runtime/port-recovery";

test("recovers a real Windows child listener with netstat and taskkill", {
  skip: process.platform !== "win32" ? "Windows only" : false,
}, async () => {
  const port = 8088;
  const child = spawn(process.execPath, [
    "-e",
    "const net=require('net'); const server=net.createServer(); server.listen(8088, '127.0.0.1', () => process.stdout.write('ready')); setInterval(() => {}, 1000);",
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  try {
    await Promise.race([
      once(child.stdout, "data"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("listener child did not start")), 5000)),
    ]);
    await recoverOccupiedPort(port, { termGraceMs: 500, killGraceMs: 500, pollIntervalMs: 50 });
    if (child.exitCode === null) await once(child, "close");

    const probe = net.createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => resolve());
    });
    await new Promise<void>((resolve, reject) => probe.close((error) => error === undefined ? resolve() : reject(error)));
    assert.equal(child.exitCode === null, false);
  } finally {
    if (child.exitCode === null) child.kill();
  }
});
