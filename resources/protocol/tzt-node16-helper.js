const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
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

function readRequest() {
  const input = fs.readFileSync(0, "utf8");
  return input ? JSON.parse(input) : {};
}

function writeResponse(payload) {
  process.stdout.write(JSON.stringify(payload));
}

const tzt = loadLegacyModule();
const request = readRequest();

if (request.method === "rc4") {
  const data = Buffer.from(request.data, "base64");
  writeResponse({ data: Buffer.from(tzt.RC4(data, request.key)).toString("base64") });
} else if (request.method === "jsonltzt") {
  writeResponse({ data: Buffer.from(tzt.jsonltzt(request.query, request.handleSerialNo)).toString("base64") });
} else if (request.method === "tztljson") {
  const data = Buffer.from(request.data, "base64");
  writeResponse({ data: tzt.tztljson(data, request.host) });
} else {
  throw new Error(`Unknown TZT protocol method: ${request.method}`);
}
