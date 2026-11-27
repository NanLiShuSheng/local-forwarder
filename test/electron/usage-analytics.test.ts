import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getUsageAnalyticsConfig,
  getUsageInstallIdPath,
  readOrCreateUsageInstallId,
  trackAppLaunch,
} from "../../electron/usage-analytics";

const FIRST_INSTALL_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_INSTALL_ID = "22222222-2222-4222-8222-222222222222";

async function withTempUserData(run: (userDataPath: string) => Promise<void>): Promise<void> {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-usage-"));
  try {
    await run(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}

test("persists and reuses one anonymous install id", async () => {
  await withTempUserData(async (userDataPath) => {
    const installIdPath = getUsageInstallIdPath(userDataPath);
    const first = await readOrCreateUsageInstallId(installIdPath, {
      generateInstallId: () => FIRST_INSTALL_ID,
    });
    const second = await readOrCreateUsageInstallId(installIdPath, {
      generateInstallId: () => SECOND_INSTALL_ID,
    });

    assert.equal(first, FIRST_INSTALL_ID);
    assert.equal(second, FIRST_INSTALL_ID);
    assert.equal((await readFile(installIdPath, "utf8")).trim(), FIRST_INSTALL_ID);
  });
});

test("sends one Umami launch pageview with an anonymous distinct id", async () => {
  await withTempUserData(async (userDataPath) => {
    const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return new Response(JSON.stringify({
        cache: "cache-token",
        sessionId: "33333333-3333-4333-8333-333333333333",
        visitId: "44444444-4444-4444-8444-444444444444",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const tracked = await trackAppLaunch({
      endpoint: "https://analytics.finbr.asia/api/send",
      websiteId: "a7e95a4d-9d8e-4b8b-93d3-6e5f4e0d8f4b",
      userDataPath,
      isPackaged: true,
      isSmokeMode: false,
      appVersion: "2.1.15",
      platform: "darwin",
      arch: "arm64",
      osVersion: "15.2.0",
      locale: "zh-CN",
      installId: FIRST_INSTALL_ID,
      fetchImpl,
    });

    assert.equal(tracked, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].input, "https://analytics.finbr.asia/api/send");
    assert.equal(requests[0].init?.method, "POST");
    assert.deepEqual(requests[0].init?.headers, {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 (compatible; LocalForwarder)",
    });
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
      type: "event",
      payload: {
        website: "a7e95a4d-9d8e-4b8b-93d3-6e5f4e0d8f4b",
        hostname: "local-forwarder",
        url: "/app_launch?appVersion=2.1.15&platform=darwin&arch=arm64",
        referrer: "",
        title: "Local Forwarder",
        language: "zh-CN",
        id: FIRST_INSTALL_ID,
        data: {
          app_version: "2.1.15",
          platform: "darwin",
          arch: "arm64",
          os_version: "15.2.0",
          locale: "zh-CN",
        },
      },
    });
  });
});

test("rejects an Umami bot-filter response that was not stored", async () => {
  await withTempUserData(async (userDataPath) => {
    const tracked = await trackAppLaunch({
      endpoint: "https://analytics.finbr.asia/api/send",
      websiteId: "a7e95a4d-9d8e-4b8b-93d3-6e5f4e0d8f4b",
      userDataPath,
      isPackaged: true,
      isSmokeMode: false,
      appVersion: "2.1.15",
      platform: "darwin",
      arch: "arm64",
      osVersion: "15.2.0",
      locale: "zh-CN",
      installId: FIRST_INSTALL_ID,
      fetchImpl: async () => new Response(JSON.stringify({ beep: "boop" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    assert.equal(tracked, false);
  });
});

test("aborts launch tracking after the configured timeout", async () => {
  await withTempUserData(async (userDataPath) => {
    let aborted = false;
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing abort signal"));
        return;
      }
      signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

    const startedAt = Date.now();
    const tracked = await trackAppLaunch({
      endpoint: "https://analytics.finbr.asia/api/send",
      websiteId: "a7e95a4d-9d8e-4b8b-93d3-6e5f4e0d8f4b",
      userDataPath,
      isPackaged: true,
      isSmokeMode: false,
      appVersion: "2.1.15",
      platform: "darwin",
      arch: "arm64",
      osVersion: "15.2.0",
      locale: "zh-CN",
      installId: FIRST_INSTALL_ID,
      timeoutMs: 25,
      fetchImpl,
    });

    assert.equal(tracked, false);
    assert.equal(aborted, true);
    assert.ok(Date.now() - startedAt < 1_000);
  });
});

test("skips launch tracking outside packaged production builds", async () => {
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests += 1;
    return new Response(null, { status: 204 });
  };
  const common = {
    endpoint: "https://analytics.finbr.asia/api/send",
    websiteId: "a7e95a4d-9d8e-4b8b-93d3-6e5f4e0d8f4b",
    userDataPath: os.tmpdir(),
    appVersion: "2.1.15",
    platform: "darwin",
    arch: "arm64",
    osVersion: "15.2.0",
    locale: "zh-CN",
    installId: FIRST_INSTALL_ID,
    fetchImpl,
  } as const;

  assert.equal(await trackAppLaunch({ ...common, isPackaged: false, isSmokeMode: false }), false);
  assert.equal(await trackAppLaunch({ ...common, isPackaged: true, isSmokeMode: true }), false);
  assert.equal(await trackAppLaunch({ ...common, websiteId: " ", isPackaged: true, isSmokeMode: false }), false);
  assert.equal(requests, 0);
});

test("swallows transport errors so startup is never blocked", async () => {
  await withTempUserData(async (userDataPath) => {
    const tracked = await trackAppLaunch({
      endpoint: "https://analytics.finbr.asia/api/send",
      websiteId: "a7e95a4d-9d8e-4b8b-93d3-6e5f4e0d8f4b",
      userDataPath,
      isPackaged: true,
      isSmokeMode: false,
      appVersion: "2.1.15",
      platform: "win32",
      arch: "x64",
      osVersion: "10.0.26100",
      locale: "zh-CN",
      installId: FIRST_INSTALL_ID,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });

    assert.equal(tracked, false);
  });
});

test("resolves Umami endpoint and website id from environment overrides", () => {
  assert.deepEqual(getUsageAnalyticsConfig({
    LOCAL_FORWARDER_UMAMI_ENDPOINT: "https://usage.example.com/api/send",
    LOCAL_FORWARDER_UMAMI_WEBSITE_ID: "website-id",
  }), {
    endpoint: "https://usage.example.com/api/send",
    websiteId: "website-id",
  });
});
