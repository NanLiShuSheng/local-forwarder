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

function dispatch(tzt, request) {
  if (request.method === "rc4") {
    const data = Buffer.from(request.data, "base64");
    return { data: Buffer.from(tzt.RC4(data, request.key)).toString("base64") };
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

function readExact(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const read = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
    if (read === 0) return false;
    offset += read;
  }
  return true;
}

// Persistent mode: length-prefixed JSON frames over stdio so the parent process
// can reuse one runtime instead of paying a process spawn per codec call.
function serve(tzt) {
  const header = Buffer.alloc(4);
  while (true) {
    if (!readExact(0, header)) return;
    const payload = Buffer.alloc(header.readUInt32LE(0));
    if (!readExact(0, payload)) return;
    let response;
    try {
      response = dispatch(tzt, JSON.parse(payload.toString("utf8")));
    } catch (error) {
      response = { error: String(error && error.message ? error.message : error) };
    }
    const out = Buffer.from(JSON.stringify(response), "utf8");
    const outHeader = Buffer.alloc(4);
    outHeader.writeUInt32LE(out.length, 0);
    fs.writeSync(1, outHeader);
    fs.writeSync(1, out);
  }
}

const tzt = loadLegacyModule();

if (process.argv.includes("--serve")) {
  serve(tzt);
} else {
  const input = fs.readFileSync(0, "utf8");
  process.stdout.write(JSON.stringify(dispatch(tzt, input ? JSON.parse(input) : {})));
}
