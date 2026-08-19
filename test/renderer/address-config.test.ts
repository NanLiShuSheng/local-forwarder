import test from "node:test";
import assert from "node:assert/strict";
import { targetFromDraft, normalizeTargetBasePath } from "../../src/renderer/components/ConfigPages";
import { getAppConfigValidationError } from "../../src/shared/validation";

test("does not emit an empty base path for root addresses", () => {
  assert.equal(normalizeTargetBasePath("/"), undefined);
  assert.equal(normalizeTargetBasePath("//"), undefined);
});

test("keeps a real target base path after trimming trailing slashes", () => {
  assert.equal(normalizeTargetBasePath("/ant///"), "/ant");
});

test("produces a saveable target for a root address", () => {
  const target = targetFromDraft({ id: "hq", name: "hq", address: "http://127.0.0.1:7778/", enabled: true }, 0);
  assert.equal(target.basePath, undefined);
  assert.equal(getAppConfigValidationError({
    server: { bindHost: "127.0.0.1", port: 8080, timeoutMs: 30000, loggingEnabled: true },
    httpRules: [],
    tcpTargets: [target],
    localValues: {},
    mapValues: {},
    accounts: {},
    cache: { rootDir: "", downloadTarget: "", decryptEnabled: false, autoDownload: false },
  }), undefined);
});
