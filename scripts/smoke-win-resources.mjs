import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");
const unpackedDir = path.resolve(
  projectRoot,
  process.env.WIN_UNPACKED_DIR ?? path.join("dist", "win-unpacked"),
);
const protocolDir = path.join(unpackedDir, "resources", "protocol");
const nodePath = path.join(protocolDir, "node", "win-x64", "node.exe");
const encoderPath = path.join(protocolDir, "encode", "h5encode-win-x86.exe");
const helperPath = path.join(protocolDir, "tzt-node16-helper.js");

async function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: projectRoot,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

async function invokeTzt(request) {
  const result = await runCommand(nodePath, [helperPath], {
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  return JSON.parse(result.stdout);
}

async function smokeWindowsResources() {
  if (process.platform !== "win32") throw new Error(`requires Windows, detected ${process.platform}`);

  const version = (await runCommand(nodePath, ["--version"])).stdout.trim();
  if (version !== "v16.13.0") throw new Error(`bundled Node runtime is ${version}, expected v16.13.0`);

  const fixed = await invokeTzt({
    method: "rc4",
    data: Buffer.from("Plaintext").toString("base64"),
    key: "file",
  });
  const fixedBytes = Buffer.from(fixed.data, "base64");
  if (fixedBytes.toString("hex") !== "7ad9f940a0c3d07a8f") throw new Error("bundled TZT runtime failed its RC4 regression vector");

  const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "local-forwarder-win-resources-"));
  try {
    const sourcePath = path.join(temporaryDir, "resource-probe.js");
    const original = Buffer.from("console.log('windows-resource-probe');\n", "utf8");
    await writeFile(sourcePath, original);
    await runCommand(encoderPath, [sourcePath]);

    const encodedPath = `${sourcePath}.d`;
    const encoded = await readFile(encodedPath);
    if (encoded.length <= 4) throw new Error("Windows H5 encoder produced an empty .d file");
    const decryptedResponse = await invokeTzt({
      method: "rc4",
      data: encoded.subarray(0, -4).toString("base64"),
      key: "file",
    });
    const decrypted = gunzipSync(Buffer.from(decryptedResponse.data, "base64"));
    if (!decrypted.equals(original)) throw new Error("Windows H5 .d output did not decrypt to the source file");
  } finally {
    await rm(temporaryDir, { recursive: true, force: true });
  }

  console.log("Windows protocol resource smoke passed: Node 16 TZT and H5 .d round-trip");
}

smokeWindowsResources().catch((error) => {
  console.error(`Windows protocol resource smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
