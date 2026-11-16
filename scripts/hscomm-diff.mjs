import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

export class HscommDiffCaseError extends Error {}

export function normalizeHscommCases(value) {
  if (!Array.isArray(value)) throw new HscommDiffCaseError("HSComm diff cases must be an array");
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) throw new HscommDiffCaseError(`HSComm diff case ${index + 1} must be an object`);
    const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name.trim() : `case-${index + 1}`;
    const path = entry.path;
    if (typeof path !== "string" || path === "") throw new HscommDiffCaseError(`HSComm diff case ${index + 1} requires a non-empty path`);
    const method = entry.method === undefined ? "GET" : entry.method;
    if (typeof method !== "string" || !/^[A-Z]+$/.test(method)) throw new HscommDiffCaseError(`HSComm diff case ${index + 1} has an invalid method`);
    const headers = entry.headers === undefined ? {} : entry.headers;
    if (typeof headers !== "object" || headers === null || Array.isArray(headers)) throw new HscommDiffCaseError(`HSComm diff case ${index + 1} headers must be an object`);
    if (entry.body !== undefined && typeof entry.body !== "string") throw new HscommDiffCaseError(`HSComm diff case ${index + 1} body must be a string`);
    if (entry.bodyBase64 !== undefined && typeof entry.bodyBase64 !== "string") throw new HscommDiffCaseError(`HSComm diff case ${index + 1} bodyBase64 must be a string`);
    if (entry.body !== undefined && entry.bodyBase64 !== undefined) throw new HscommDiffCaseError(`HSComm diff case ${index + 1} cannot define both body and bodyBase64`);
    return { ...entry, name, method, path, headers };
  });
}

function bodyFor(testCase) {
  if (testCase.bodyBase64 !== undefined) return Buffer.from(testCase.bodyBase64, "base64");
  if (testCase.body !== undefined) return testCase.body;
  return undefined;
}

async function requestHscomm(baseUrl, testCase) {
  const response = await fetch(new URL(testCase.path, baseUrl), {
    method: testCase.method,
    headers: testCase.headers,
    body: bodyFor(testCase),
  });
  const body = Buffer.from(await response.arrayBuffer());
  return {
    statusCode: response.status,
    contentType: response.headers.get("content-type") ?? "",
    contentEncoding: response.headers.get("content-encoding") ?? "",
    body,
  };
}

function responseDifference(field, reference, candidate) {
  return { field, reference, candidate };
}

function compareHscommResponses(reference, candidate) {
  const differences = [];
  if (reference.statusCode !== candidate.statusCode) {
    differences.push(responseDifference("statusCode", reference.statusCode, candidate.statusCode));
  }
  if (reference.contentType.toLowerCase() !== candidate.contentType.toLowerCase()) {
    differences.push(responseDifference("contentType", reference.contentType, candidate.contentType));
  }
  if (reference.contentEncoding.toLowerCase() !== candidate.contentEncoding.toLowerCase()) {
    differences.push(responseDifference("contentEncoding", reference.contentEncoding, candidate.contentEncoding));
  }
  if (!reference.body.equals(candidate.body)) {
    differences.push(responseDifference("body", reference.body.toString("utf8"), candidate.body.toString("utf8")));
  }
  return differences;
}

export async function runHscommDiff(options) {
  const cases = normalizeHscommCases(options.cases);
  const results = [];
  for (const testCase of cases) {
    let reference;
    let candidate;
    let error;
    try {
      [reference, candidate] = await Promise.all([
        requestHscomm(options.referenceBaseUrl, testCase),
        requestHscomm(options.candidateBaseUrl, testCase),
      ]);
    } catch (requestError) {
      error = requestError instanceof Error ? requestError.message : String(requestError);
    }
    const differences = error === undefined ? compareHscommResponses(reference, candidate) : [{ field: "request", reference: "", candidate: error }];
    results.push({
      name: testCase.name,
      method: testCase.method,
      path: testCase.path,
      status: differences.length === 0 ? "match" : "mismatch",
      differences,
    });
  }
  return {
    mismatchCount: results.filter(result => result.status === "mismatch").length,
    caseCount: results.length,
    results,
  };
}

function commandOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const casesPath = commandOption("cases");
  const referenceBaseUrl = commandOption("reference");
  const candidateBaseUrl = commandOption("candidate");
  if (casesPath === undefined || referenceBaseUrl === undefined || candidateBaseUrl === undefined) {
    throw new Error("usage: node scripts/hscomm-diff.mjs --cases cases.json --reference http://win-host:7778 --candidate http://mac-host:7778");
  }
  const cases = normalizeHscommCases(JSON.parse(await readFile(casesPath, "utf8")));
  const result = await runHscommDiff({ referenceBaseUrl, candidateBaseUrl, cases });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.mismatchCount === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
