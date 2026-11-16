import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runHscommDiff } from "../../scripts/hscomm-diff.mjs";

async function listen(handler: http.RequestListener): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("compares Win reference and Mac candidate HTTP responses byte-for-byte", async () => {
  const reference = await listen((request, response) => {
    response.writeHead(200, { "content-type": "application/x-www-form-urlencoded" });
    response.end("ErrorNo=0\r\nAction=41035\r\n");
  });
  const same = await listen((request, response) => {
    response.writeHead(200, { "content-type": "application/x-www-form-urlencoded" });
    response.end("ErrorNo=0\r\nAction=41035\r\n");
  });
  const different = await listen((request, response) => {
    response.writeHead(200, { "content-type": "application/x-www-form-urlencoded" });
    response.end("ErrorNo=1\r\nAction=41035\r\n");
  });

  try {
    const testCase = {
      name: "news probe",
      method: "POST",
      path: "/LoadBalance.dll",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "Action=41035",
    };

    const passing = await runHscommDiff({ referenceBaseUrl: reference.baseUrl, candidateBaseUrl: same.baseUrl, cases: [testCase] });
    assert.equal(passing.mismatchCount, 0);
    assert.equal(passing.results[0]?.status, "match");

    const failing = await runHscommDiff({ referenceBaseUrl: reference.baseUrl, candidateBaseUrl: different.baseUrl, cases: [testCase] });
    assert.equal(failing.mismatchCount, 1);
    assert.equal(failing.results[0]?.status, "mismatch");
    assert.deepEqual(failing.results[0]?.differences, [{ field: "body", reference: "ErrorNo=0\r\nAction=41035\r\n", candidate: "ErrorNo=1\r\nAction=41035\r\n" }]);
  } finally {
    await close(reference.server);
    await close(same.server);
    await close(different.server);
  }
});
