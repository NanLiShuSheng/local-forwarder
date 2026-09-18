import path from "node:path";

export function getRendererIndexPath(compiledMainDir: string): string {
  return path.resolve(compiledMainDir, "../../dist/index.html");
}

export function getPreloadPath(compiledMainDir: string): string {
  return path.resolve(compiledMainDir, "preload.js");
}

export function getEncryptionEncoderPath(
  compiledMainDir: string,
  isPackaged: boolean,
  resourcesPath: string,
  platform = process.platform,
  arch = process.arch,
): string {
  const resourceRoot = isPackaged ? resourcesPath : path.resolve(compiledMainDir, "../../resources");
  if (platform === "darwin" && arch === "x64") return path.join(resourceRoot, "protocol", "encode", "h5encode-mac-amd64");
  if (platform === "win32" && arch === "x64") return path.join(resourceRoot, "protocol", "encode", "h5encode-win-x86.exe");
  throw new Error(`Unsupported encryption encoder platform: ${platform}/${arch}`);
}

export function getEncryptionPreferencesPath(userDataPath: string): string {
  return path.join(userDataPath, "encryption-preferences.json");
}
