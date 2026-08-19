const fs = require("node:fs");
const vm = require("node:vm");
const v8 = require("node:v8");

v8.setFlagsFromString("--no-flush-bytecode");

function getHeader(buffer, offset) {
  return buffer.subarray(offset, offset + 4);
}

function setHeader(buffer, offset, value) {
  value.copy(buffer, offset);
}

function buf2num(buffer) {
  return (buffer[0] | (buffer[1] << 8) | (buffer[2] << 16) | (buffer[3] << 24)) | 0;
}

function loadBytecode(filePath) {
  const bytecode = fs.readFileSync(filePath);
  const emptyScript = new vm.Script("");
  setHeader(bytecode, 12, emptyScript.createCachedData().subarray(12, 16));
  const sourceHash = buf2num(getHeader(bytecode, 8));
  const source = " ".repeat(Math.max(0, sourceHash));
  const script = new vm.Script(source, { filename: filePath, cachedData: bytecode });
  if (script.cachedDataRejected) throw new Error("TZT protocol bytecode was rejected by this Node runtime");
  return script;
}

module.exports = { loadBytecode };
