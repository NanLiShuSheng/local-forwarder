import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bottom status bar exposes the official website entry at its far right", async () => {
  const [appSource, chromeSource, styles, contracts, mainSource, preloadSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/WorkspaceChrome.tsx", "utf8"),
    readFile("src/renderer/styles.css", "utf8"),
    readFile("src/shared/contracts.ts", "utf8"),
    readFile("electron/main.ts", "utf8"),
    readFile("electron/preload.ts", "utf8"),
  ]);

  assert.match(contracts, /openOfficialWebsite\(\): Promise<void>/);
  assert.match(contracts, /openOfficialWebsite: "app:official-website:open"/);
  assert.match(preloadSource, /openOfficialWebsite: \(\) => ipcRenderer\.invoke\(IPC_CHANNELS\.openOfficialWebsite\)/);
  assert.match(mainSource, /IPC_CHANNELS\.openOfficialWebsite[\s\S]*?shell\.openExternal\(OFFICIAL_WEBSITE_URL\)/);
  assert.match(mainSource, /const OFFICIAL_WEBSITE_URL = "https:\/\/www\.finbr\.asia\/"/);
  assert.match(appSource, /const openOfficialWebsite = \(\) => \{[\s\S]*?window\.forwarder\.openOfficialWebsite\(\)/);
  assert.match(appSource, /<WorkspaceStatusbar[\s\S]*?onOpenOfficialWebsite=\{openOfficialWebsite\}/);
  assert.match(chromeSource, /<span className="lf-status-item">v\{version \|\| "—"\}<\/span>[\s\S]*?className="lf-status-site"[\s\S]*?<\/footer>/);
  assert.match(chromeSource, /title="打开官网"/);
  assert.match(chromeSource, /name="external-link"/);
  assert.match(chromeSource, /<span>官网首页<\/span>/);
  assert.match(styles, /\.lf-status-site\s*\{/);
});
