import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workspace pages stay mounted after their first visit so runtime results survive navigation", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /function PagePane\(/);
  assert.match(source, /const \[hasOpened, setHasOpened\] = useState\(active\)/);
  assert.match(source, /className="lf-view" hidden=\{!active\}/);

  for (const route of ["workbench", "activity", "debug", "build", "jobs", "appearance", "update", "advanced"]) {
    assert.match(source, new RegExp(`<PagePane active=\\{route === "${route}"\\}>`), `missing persistent route: ${route}`);
  }
  assert.doesNotMatch(source, /EnvironmentPage|route === "environment"/);
  assert.match(source, /<PagePane active=\{isDataRoute\}>/);
  assert.match(source, /<PagePane active=\{route === "json" \|\| route === "logs" \|\| route === "string"\}>/);
  assert.doesNotMatch(source, /route === "debug" && <RequestPage/);
  assert.doesNotMatch(source, /route === "build" && <BuildPage/);
});

test("the unified build workspace and request page stay mounted while other pages are active", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /<PagePane active=\{route === "debug"\}>[\s\S]*?<RequestPage config=\{config\} active=\{route === "debug"\}/);
  assert.match(source, /<PagePane active=\{route === "build"\}>[\s\S]*?<BuildPage onCreateTask=\{createBuildTask\}/);
  assert.match(source, /<KeepAlivePane active=\{route === "json"\}><JsonPreviewPage/);
  assert.match(source, /<KeepAlivePane active=\{route === "logs"\}><LogPanel/);
  assert.match(source, /<KeepAlivePane active=\{route === "string"\}><StringToolPage config=\{config\} \/><\/KeepAlivePane>/);
  assert.doesNotMatch(source, /<DecryptionPage/);
});

test("hidden pages do not keep page-level keyboard shortcuts active", async () => {
  const [appSource, requestSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/RequestPage.tsx", "utf8"),
  ]);

  assert.match(appSource, /<RequestPage config=\{config\} active=\{route === "debug"\}/);
  assert.match(requestSource, /useEffect\(\(\) => \{\s*if \(!active\) return;[\s\S]*?handleShortcut/);
});
