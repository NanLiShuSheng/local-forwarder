import { writeFileSync } from "node:fs";
import path from "node:path";

const outputDir = path.resolve("dist-electron");

writeFileSync(
  path.join(outputDir, "main.js"),
  'module.exports = require("./electron/main.js");\n',
);
writeFileSync(
  path.join(outputDir, "preload.js"),
  'module.exports = require("./electron/preload.js");\n',
);
