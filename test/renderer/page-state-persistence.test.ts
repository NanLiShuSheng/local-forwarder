import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("feature pages stay mounted after their first visit so runtime results survive navigation", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /function PagePane\(/);
  assert.match(source, /const \[hasOpened, setHasOpened\] = useState\(active\)/);
  assert.match(source, /className="page-pane" hidden=\{!active\}/);

  for (const page of ["request", "string", "decryption", "local", "local-cache", "values", "appearance", "logs", "json"]) {
    assert.match(source, new RegExp(`<PagePane active=\\{page === "${page}"\\}>`));
  }

  assert.doesNotMatch(source, /page === "request" && <RequestPage/);
  assert.doesNotMatch(source, /page === "decryption" && <DecryptionPage/);
  assert.doesNotMatch(source, /page === "local" && <LocalVariablesPage/);
});

test("the encryption workspace and request page stay mounted while other tabs are active", async () => {
  const source = await readFile("src/renderer/App.tsx", "utf8");

  assert.match(source, /<PagePane active=\{page === "runtime" \|\| page === "encryption"\}>/);
  assert.match(source, /<ConfigPages page=\{page === "runtime" \? "addresses" : page\}/);
  assert.match(source, /<PagePane active=\{page === "string"\}><StringToolPage config=\{config\} \/><\/PagePane>/);
  assert.match(source, /<RequestPage config=\{config\} onChange=\{save\} onSendRequest=\{sendRequest\} \/>/);
});

test("hidden pages do not keep page-level keyboard shortcuts active", async () => {
  const [appSource, localVariablesSource, localCacheSource] = await Promise.all([
    readFile("src/renderer/App.tsx", "utf8"),
    readFile("src/renderer/components/LocalVariablesPage.tsx", "utf8"),
    readFile("src/renderer/components/LocalCachePage.tsx", "utf8"),
  ]);

  assert.match(appSource, /<LocalVariablesPage active=\{page === "local"\} \/>/);
  assert.match(appSource, /<LocalCachePage active=\{page === "local-cache"\} instanceId=\{selectedInstance\?\.id\} \/>/);
  assert.match(localVariablesSource, /if \(!active\b/);
  assert.match(localCacheSource, /if \(!active\b/);
});
