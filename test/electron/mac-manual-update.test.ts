import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareVersions,
  createMacManualUpdateAdapter,
  createMacUpdateUrls,
  parseMacUpdateManifest,
} from "../../electron/mac-manual-update";
import type { UpdateInfoSnapshot, UpdateProgressSnapshot } from "../../src/shared/contracts";

interface TestServer {
  manifestUrl: string;
  downloadBaseUrl: string;
  close: () => Promise<void>;
}

interface TestRoute {
  body: Buffer;
  contentType: string;
  status?: number;
  headers?: Record<string, string>;
}

async function startServer(routes: Map<string, TestRoute>): Promise<TestServer> {
  const server = createServer((request, response) => {
    const route = routes.get(request.url ?? "");
    if (route === undefined) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    response.writeHead(route.status ?? 200, {
      "Content-Type": route.contentType,
      "Content-Length": route.body.length,
      ...route.headers,
    });
    response.end(route.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server did not bind to a port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    manifestUrl: `${baseUrl}/mac-update.json`,
    downloadBaseUrl: `${baseUrl}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function sha512(value: Buffer): string {
  return createHash("sha512").update(value).digest("base64");
}

function manifestBody(version: string, fileName: string, payload: Buffer): Buffer {
  return Buffer.from(JSON.stringify({
    version,
    releaseDate: "2026-11-11T00:00:00.000Z",
    files: [{ arch: "x64", name: fileName, sha512: sha512(payload), size: payload.length }],
  }));
}

test("compares stable and prerelease versions", () => {
  assert.equal(compareVersions("1.2.3", "1.2.2"), 1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("1.2.3-beta.1", "1.2.3"), -1);
  assert.equal(compareVersions("1.2.3-beta.2", "1.2.3-beta.1"), 1);
});

test("builds the latest Tencent Cloud download URLs", () => {
  assert.deepEqual(createMacUpdateUrls(), {
    manifestUrl: "https://www.finbr.asia/local-forwarder/mac-update.json",
    downloadBaseUrl: "https://www.finbr.asia/local-forwarder/",
  });
  assert.deepEqual(createMacUpdateUrls("https://updates.example.com/local-forwarder"), {
    manifestUrl: "https://updates.example.com/local-forwarder/mac-update.json",
    downloadBaseUrl: "https://updates.example.com/local-forwarder/",
  });
});

test("parses the macOS update manifest and rejects unsafe file names", () => {
  const valid = parseMacUpdateManifest({
    version: "1.1.0",
    files: [{ arch: "x64", name: "Local-Forwarder-1.1.0-mac.dmg", sha512: "abc+/=", size: 12 }],
  });
  assert.equal(valid.version, "1.1.0");
  assert.equal(valid.files[0]?.arch, "x64");

  assert.throws(() => parseMacUpdateManifest({
    version: "1.1.0",
    files: [{ arch: "x64", name: "../evil.dmg", sha512: "abc", size: 12 }],
  }), /文件名无效/);
});

test("checks GitHub metadata, downloads the DMG with progress, and opens it", async () => {
  const payload = Buffer.from("fake dmg payload");
  const fileName = "Local-Forwarder-1.1.0-mac.dmg";
  const server = await startServer(new Map([
    ["/mac-update.json", { body: manifestBody("1.1.0", fileName, payload), contentType: "application/json" }],
    [`/${fileName}`, { body: payload, contentType: "application/x-apple-diskimage" }],
  ]));
  const downloadDirectory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-mac-update-"));
  const openedPaths: string[] = [];
  const available: UpdateInfoSnapshot[] = [];
  const downloaded: UpdateInfoSnapshot[] = [];
  const progress: UpdateProgressSnapshot[] = [];
  const adapter = createMacManualUpdateAdapter({
    currentVersion: "1.0.0",
    architecture: "x64",
    manifestUrl: server.manifestUrl,
    downloadBaseUrl: server.downloadBaseUrl,
    downloadDirectory,
    openPath: async (filePath) => {
      openedPaths.push(filePath);
      return "";
    },
  });
  adapter.onUpdateAvailable((info) => available.push(info));
  adapter.onUpdateDownloaded((info) => downloaded.push(info));
  adapter.onDownloadProgress((value) => progress.push(value));

  try {
    await adapter.checkForUpdates();
    assert.equal(available[0]?.version, "1.1.0");
    assert.equal(available[0]?.releaseDate, "2026-11-11T00:00:00.000Z");

    const downloadedPath = await adapter.downloadUpdate();
    assert.equal(downloadedPath, path.join(downloadDirectory, fileName));
    assert.deepEqual(await readFile(downloadedPath), payload);
    assert.equal(downloaded[0]?.version, "1.1.0");
    assert.equal(progress.at(-1)?.percent, 100);
    assert.equal(progress.at(-1)?.transferred, payload.length);

    await adapter.openDownloadedUpdate();
    assert.deepEqual(openedPaths, [downloadedPath]);
  } finally {
    await server.close();
    await rm(downloadDirectory, { recursive: true, force: true });
  }
});

test("rejects a downloaded DMG whose SHA-512 does not match", async () => {
  const payload = Buffer.from("fake dmg payload");
  const fileName = "Local-Forwarder-1.1.0-mac.dmg";
  const manifest = JSON.parse(manifestBody("1.1.0", fileName, Buffer.from("different payload")).toString());
  const server = await startServer(new Map([
    ["/mac-update.json", { body: Buffer.from(JSON.stringify(manifest)), contentType: "application/json" }],
    [`/${fileName}`, { body: payload, contentType: "application/x-apple-diskimage" }],
  ]));
  const downloadDirectory = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-mac-update-"));
  const adapter = createMacManualUpdateAdapter({
    currentVersion: "1.0.0",
    architecture: "x64",
    manifestUrl: server.manifestUrl,
    downloadBaseUrl: server.downloadBaseUrl,
    downloadDirectory,
    openPath: async () => "",
  });

  try {
    await adapter.checkForUpdates();
    await assert.rejects(adapter.downloadUpdate(), (error: unknown) => {
      assert.equal((error as { code?: unknown }).code, "ERR_MANUAL_UPDATE_CHECKSUM");
      return true;
    });
    await assert.rejects(readFile(path.join(downloadDirectory, fileName)), /ENOENT/);
  } finally {
    await server.close();
    await rm(downloadDirectory, { recursive: true, force: true });
  }
});

test("reports no update when the manifest version is not newer", async () => {
  const payload = Buffer.from("same version");
  const fileName = "Local-Forwarder-1.0.0-mac.dmg";
  const server = await startServer(new Map([
    ["/mac-update.json", { body: manifestBody("1.0.0", fileName, payload), contentType: "application/json" }],
  ]));
  let availableCalls = 0;
  let notAvailableCalls = 0;
  const adapter = createMacManualUpdateAdapter({
    currentVersion: "1.0.0",
    architecture: "x64",
    manifestUrl: server.manifestUrl,
    downloadBaseUrl: server.downloadBaseUrl,
    downloadDirectory: os.tmpdir(),
    openPath: async () => "",
  });
  adapter.onUpdateAvailable(() => { availableCalls += 1; });
  adapter.onUpdateNotAvailable(() => { notAvailableCalls += 1; });

  try {
    await adapter.checkForUpdates();
    assert.equal(availableCalls, 0);
    assert.equal(notAvailableCalls, 1);
  } finally {
    await server.close();
  }
});

test("reports no update when the latest release manifest is missing", async () => {
  const server = await startServer(new Map([
    ["/mac-update.json", {
      body: Buffer.alloc(0),
      contentType: "text/plain",
      status: 302,
      headers: { Location: "/releases/download/v1.1.0/mac-update.json" },
    }],
  ]));
  let availableCalls = 0;
  let notAvailableCalls = 0;
  let errorCalls = 0;
  const adapter = createMacManualUpdateAdapter({
    currentVersion: "1.0.0",
    architecture: "x64",
    manifestUrl: server.manifestUrl,
    downloadBaseUrl: server.downloadBaseUrl,
    downloadDirectory: os.tmpdir(),
    openPath: async () => "",
  });
  adapter.onUpdateAvailable(() => { availableCalls += 1; });
  adapter.onUpdateNotAvailable(() => { notAvailableCalls += 1; });
  adapter.onError(() => { errorCalls += 1; });

  try {
    await adapter.checkForUpdates();
    assert.equal(availableCalls, 0);
    assert.equal(notAvailableCalls, 1);
    assert.equal(errorCalls, 0);
  } finally {
    await server.close();
  }
});
