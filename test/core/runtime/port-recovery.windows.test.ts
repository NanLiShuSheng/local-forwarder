import assert from "node:assert/strict";
import { once } from "node:events";
import net from "node:net";
import { spawn } from "node:child_process";
import test from "node:test";
import { recoverOccupiedPort } from "../../../src/core/runtime/port-recovery";

const PORT_RANGE_START = 8080;
const PORT_RANGE_END = 8089;

async function findAvailablePort(): Promise<number> {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port += 1) {
    const server = net.createServer();
    const available = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close((error) => resolve(error === undefined));
      });
    });
    if (available) return port;
  }
  throw new Error(`no available test port in ${PORT_RANGE_START}-${PORT_RANGE_END}`);
}

async function waitForListener(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("listener child did not start")), 5000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onData = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(new Error(`listener child exited before ready (code=${code ?? "null"}, signal=${signal ?? "none"})`));
    };
    child.stdout?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

test("recovers a real Windows child listener with netstat and taskkill", {
  skip: process.platform !== "win32" ? "Windows only" : false,
}, async () => {
  const port = await findAvailablePort();
  const child = spawn(process.execPath, [
    "-e",
    `const net=require('net'); const server=net.createServer(); server.listen(${port}, '127.0.0.1', () => process.stdout.write('ready')); setInterval(() => {}, 1000);`,
  ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });

  try {
    await waitForListener(child);
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
