import test from "node:test";
import assert from "node:assert/strict";
import type { ForwardRule } from "../../../src/shared/contracts";
import {
  matchRule,
  parseTarget,
  substituteVariables,
} from "../../../src/core/routing/rule-matcher";
import { redactObject, redactQuery } from "../../../src/core/runtime/redact";

function rule(id: string, match: string, enabled = true): ForwardRule {
  return {
    id,
    name: id,
    match,
    target: "http://example.test",
    enabled,
  };
}

test("chooses the longest enabled URL match", () => {
  const matched = matchRule("/reqxml?Action=100", [
    rule("short", "/"),
    rule("long", "/reqxml"),
    rule("disabled", "/reqxml?Action=100", false),
  ]);

  assert.equal(matched?.id, "long");
});

test("uses the ascending id when enabled matches have equal length", () => {
  const matched = matchRule("/same/path", [rule("z", "/same"), rule("a", "/same")]);

  assert.equal(matched?.id, "a");
});

test("returns undefined when no enabled rule includes the URL", () => {
  assert.equal(matchRule("/missing", [rule("disabled", "/missing", false), rule("other", "/other")]), undefined);
});

test("replaces supported local variable placeholder encodings case-insensitively", () => {
  const input = "/path/($TOKEN)/$(mobile)/(%24mobile)/%28$mobile%29/%28%24Account%29/($UNKNOWN)/$TOKEN";

  assert.equal(
    substituteVariables(input, { token: "abc", MOBILE: "13800000000", account: "acct" }),
    "/path/abc/13800000000/13800000000/13800000000/acct/($UNKNOWN)/$TOKEN",
  );
});

test("does not replace text outside the supported placeholder forms", () => {
  const input = "($TOKEN_EXTRA) ($TOKEN $TOKEN) $TOKEN";

  assert.equal(substituteVariables(input, { TOKEN: "abc" }), input);
});

test("parses targets and applies protocol default ports", () => {
  assert.equal(parseTarget("http://example.test/path?x=1").port, 80);
  assert.equal(parseTarget("https://example.test/path").port, 443);
  assert.equal(parseTarget("tcp://127.0.0.1/stream").port, 80);

  const parsed = parseTarget("https://example.test/path?x=1#fragment");
  assert.equal(parsed.protocol, "https");
  assert.equal(parsed.hostname, "example.test");
  assert.equal(parsed.pathname, "/path");
  assert.equal(parsed.search, "?x=1");
  assert.equal(parsed.hash, "#fragment");
  assert.equal(parsed.path, "/path?x=1");

  const withUserInfoAndIpv6 = parseTarget("https://user:pass@[::1]:8443/path?q=1#fragment");
  assert.equal(withUserInfoAndIpv6.hostname, "[::1]");
  assert.equal(withUserInfoAndIpv6.port, 8443);
  assert.equal(withUserInfoAndIpv6.path, "/path?q=1");
});

test("rejects unsupported protocols, invalid ports, and missing hosts", () => {
  assert.throws(() => parseTarget("ftp://example.test/file"), /unsupported protocol/i);
  assert.throws(() => parseTarget("constructor://example.test/file"), /unsupported protocol/i);
  assert.throws(() => parseTarget("http://example.test:0/file"), /invalid port/i);
  assert.throws(() => parseTarget("http://example.test:65536/file"), /invalid target|invalid port/i);
  assert.throws(() => parseTarget("http:///file"), /host|invalid target/i);
});

test("rejects explicitly empty ports for supported protocols", () => {
  assert.throws(() => parseTarget("http://example.test:"), /invalid port/i);
  assert.throws(() => parseTarget("https://example.test:"), /invalid port/i);
  assert.throws(() => parseTarget("tcp://127.0.0.1:"), /invalid port/i);
});

test("requires supported targets to use an authority", () => {
  for (const protocol of ["http", "https", "tcp"]) {
    assert.throws(() => parseTarget(`${protocol}:/host`), /invalid target|authority|host/i);
    assert.throws(() => parseTarget(`${protocol}:host`), /invalid target|authority|host/i);
  }
});

test("redacts nested sensitive object keys without changing the original", () => {
  const original = {
    password: "secret-password",
    Profile: {
      TOKEN: "secret-token",
      safe: "keep",
      items: [{ mobile: "13800000000" }, null, 3],
    },
    authorization: { value: "secret-auth" },
    account: "secret-account",
  };

  const redacted = redactObject(original);

  assert.deepEqual(redacted, {
    password: "***",
    Profile: {
      TOKEN: "***",
      safe: "keep",
      items: [{ mobile: "***" }, null, 3],
    },
    authorization: "***",
    account: "***",
  });
  assert.deepEqual(original, {
    password: "secret-password",
    Profile: {
      TOKEN: "secret-token",
      safe: "keep",
      items: [{ mobile: "13800000000" }, null, 3],
    },
    authorization: { value: "secret-auth" },
    account: "secret-account",
  });
  assert.equal(redactObject(null), null);
  assert.equal(redactObject("plain"), "plain");
});

test("redacts repeated and encoded sensitive query parameters while preserving other URL parts", () => {
  const url = "https://example.test/path?%74oken=first&TOKEN=second&item=keep&mobile=third&item=again#fragment";

  assert.equal(
    redactQuery(url),
    "https://example.test/path?%74oken=***&TOKEN=***&item=keep&mobile=***&item=again#fragment",
  );
});

test("redacts sensitive query parameters from relative HTTP request paths", () => {
  assert.equal(redactQuery("/path?token=secret&item=keep"), "/path?token=***&item=keep");
});

test("does not treat fragment text as a query", () => {
  assert.equal(redactQuery("#fragment?token=secret"), "#fragment?token=secret");
  assert.equal(redactQuery("/path#fragment?token=secret"), "/path#fragment?token=secret");
  assert.equal(redactQuery("https://example.test/path#fragment?token=secret"), "https://example.test/path#fragment?token=secret");
});

test("returns invalid URLs safely from query redaction", () => {
  assert.equal(redactQuery("not a URL?token=secret"), "not a URL?token=secret");
});
