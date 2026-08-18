import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import packageJson from "../../package.json";

const projectRoot = path.resolve(import.meta.dirname, "../..");

test("renderer strict type checking has React and Vite declarations", () => {
  assert.equal(packageJson.devDependencies["@types/react"], "latest");
  assert.equal(packageJson.devDependencies["@types/react-dom"], "latest");
  assert.equal(fs.existsSync(path.join(projectRoot, "src/renderer/vite-env.d.ts")), true);
});

test("the production build runs the strict renderer type check", () => {
  assert.match(packageJson.scripts.build, /tsc -p tsconfig\.json --noEmit/);
});
