import path from "node:path";

export function getRendererIndexPath(compiledMainDir: string): string {
  return path.resolve(compiledMainDir, "../../dist/index.html");
}

export function getPreloadPath(compiledMainDir: string): string {
  return path.resolve(compiledMainDir, "preload.js");
}
