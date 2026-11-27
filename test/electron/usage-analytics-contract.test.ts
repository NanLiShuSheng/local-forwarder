import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("app launch analytics runs once after the first window is created", async () => {
  const main = await readFile("electron/main.ts", "utf8");
  const readyBlock = main.match(/app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?\n\}\);/)?.[0] ?? "";
  const activateBlock = main.match(/app\.on\("activate",[\s\S]*?\n  \}\);/)?.[0] ?? "";

  assert.match(main, /import \{ getUsageAnalyticsConfig, trackAppLaunch \} from "\.\/usage-analytics";/);
  assert.match(readyBlock, /createWindow\(rendererSecurityPolicy\);[\s\S]*?startBackgroundCheck\(\);[\s\S]*?trackAppLaunch\(/);
  assert.equal((readyBlock.match(/trackAppLaunch\(/g) ?? []).length, 1);
  assert.match(readyBlock, /isPackaged: app\.isPackaged/);
  assert.match(readyBlock, /isSmokeMode: smokeMode/);
  assert.match(readyBlock, /userDataPath: app\.getPath\("userData"\)/);
  assert.doesNotMatch(activateBlock, /trackAppLaunch\(/);
});

test("self-hosted Umami deployment keeps the dashboard private and exposes only ingestion", async () => {
  const [compose, caddy, docs, env, deployScript] = await Promise.all([
    readFile("deploy/umami/docker-compose.yml", "utf8"),
    readFile("deploy/umami/Caddyfile.example", "utf8"),
    readFile("docs/usage-analytics.md", "utf8"),
    readFile("deploy/umami/.env.example", "utf8"),
    readFile("scripts/deploy-umami.sh", "utf8"),
  ]);

  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /umami-db-data/);
  assert.match(compose, /APP_SECRET: \$\{UMAMI_APP_SECRET\}/);
  assert.match(compose, /umamisoftware\/umami:3\.5\.0/);
  assert.match(compose, /\/api\/heartbeat/);
  assert.match(env, /TWO_FACTOR_ENCRYPTION_KEY/);
  assert.match(caddy, /@ingest \{[\s\S]*?path \/api\/send[\s\S]*?method POST[\s\S]*?\}/);
  assert.match(caddy, /basic_auth \{/);
  assert.match(caddy, /@api path \/api\/\*/);
  assert.match(docs, /USAGE_ANALYTICS_WEBSITE_ID/);
  assert.match(docs, /近 30 天/);
  assert.match(docs, /count\(DISTINCT s\.distinct_id\)/);
  assert.match(docs, /caddy hash-password/);
  assert.match(deployScript, /compose up -d/);
  assert.match(deployScript, /sudo -n docker info/);
  assert.match(deployScript, /Caddy was not modified/);
});
