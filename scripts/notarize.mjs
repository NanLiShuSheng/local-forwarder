import path from "node:path";
import { notarize } from "@electron/notarize";

const requiredEnvironment = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

function requireSigningEnvironment() {
  const missing = requiredEnvironment.filter((name) => !(process.env[name] ?? "").trim());
  if (missing.length > 0) throw new Error(`macOS 签名/公证环境不完整，缺少: ${missing.join(", ")}`);
}

export default async function notarizeApp(context) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  requireSigningEnvironment();

  const { appOutDir, packager } = context;
  await notarize({
    appBundleId: packager.appInfo.id,
    appPath: path.join(appOutDir, `${packager.appInfo.productFilename}.app`),
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
}
