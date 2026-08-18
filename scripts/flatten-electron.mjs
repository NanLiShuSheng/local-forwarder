import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputDir = path.resolve("dist-electron");
const compiledPreload = path.join(outputDir, "electron", "preload.js");

if (/src\/shared\/contracts|require\([^)]*contracts/.test(readFileSync(compiledPreload, "utf8"))) {
  throw new Error("Sandbox preload must not have a runtime dependency on src/shared/contracts.");
}

writeFileSync(
  path.join(outputDir, "main.js"),
  'module.exports = require("./electron/main.js");\n',
);
writeFileSync(
  path.join(outputDir, "preload.js"),
  'module.exports = require("./electron/preload.js");\n',
);
