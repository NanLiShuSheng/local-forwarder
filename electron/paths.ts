import path from "node:path";

export function getRendererIndexPath(compiledMainDir: string): string {
  return path.resolve(compiledMainDir, "../../dist/index.html");
}

export function getPreloadPath(compiledMainDir: string): string {
  return path.resolve(compiledMainDir, "preload.js");
}

export function getEncryptionEncoderPath(compiledMainDir: string, isPackaged: boolean, resourcesPath: string): string {
  const resourceRoot = isPackaged ? resourcesPath : path.resolve(compiledMainDir, "../../resources");
  return path.join(resourceRoot, "protocol", "encode", "h5encode-mac-amd64");
}
