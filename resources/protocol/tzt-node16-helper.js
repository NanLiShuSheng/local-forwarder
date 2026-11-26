const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const readline = require("node:readline");
const { loadBytecode } = require("./loader");
const makeRequire = require("./make-require");

function loadLegacyModule() {
  const filename = path.resolve(__dirname, "tzt.bytecode-16.13.0");
  const wrapper = loadBytecode(filename).runInThisContext();
  const mod = new Module(filename, module.parent);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  wrapper.call(mod, mod.exports, makeRequire(mod), mod, filename, path.dirname(filename));
  return mod.exports;
}

function executeRequest(tzt, request) {
  if (request.method === "rc4") {
    const data = Buffer.from(request.data, "base64");
    return { data: Buffer.from(tzt.RC4(data, request.key)).toString("base64") };
  }
  if (request.method === "rc4batch") {
    if (!Array.isArray(request.data)) throw new Error("rc4batch data must be an array");
    return {
      data: request.data.map((entry) => {
        const data = Buffer.from(entry, "base64");
        return Buffer.from(tzt.RC4(data, request.key)).toString("base64");
      }),
    };
  }
  if (request.method === "jsonltzt") {
    return { data: Buffer.from(tzt.jsonltzt(request.query, request.handleSerialNo)).toString("base64") };
  }
  if (request.method === "tztljson") {
    const data = Buffer.from(request.data, "base64");
    return { data: tzt.tztljson(data, request.host) };
  }
  throw new Error(`Unknown TZT protocol method: ${request.method}`);
}

function writeResponse(payload, lineDelimited) {
  process.stdout.write(`${JSON.stringify(payload)}${lineDelimited ? "\n" : ""}`);
}

const tzt = loadLegacyModule();

if (process.argv.includes("--server")) {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    let id;
    try {
      const request = line ? JSON.parse(line) : {};
      id = request.id;
      writeResponse({ id, ...executeRequest(tzt, request) }, true);
    } catch (error) {
      writeResponse({ id, error: error instanceof Error ? error.message : String(error) }, true);
    }
  });
} else {
  const requestInput = fs.readFileSync(0, "utf8");
  const request = requestInput ? JSON.parse(requestInput) : {};
  writeResponse(executeRequest(tzt, request), false);
}
