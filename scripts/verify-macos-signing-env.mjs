const requiredEnvironment = [
  { name: "CSC_LINK", secret: "MACOS_CERTIFICATE_BASE64" },
  { name: "CSC_KEY_PASSWORD", secret: "MACOS_CERTIFICATE_PASSWORD" },
  { name: "APPLE_ID", secret: "APPLE_ID" },
  { name: "APPLE_APP_SPECIFIC_PASSWORD", secret: "APPLE_APP_SPECIFIC_PASSWORD" },
  { name: "APPLE_TEAM_ID", secret: "APPLE_TEAM_ID" },
];

function missingEnvironment() {
  return requiredEnvironment.filter(({ name }) => !(process.env[name] ?? "").trim());
}

if (process.env.GITHUB_ACTIONS !== "true") {
  console.log("本地构建跳过签名环境检查");
} else {
  const missing = missingEnvironment();
  if (missing.length > 0) {
    console.error(`macOS 签名/公证环境不完整，缺少: ${missing.map(({ name }) => name).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("macOS 签名/公证环境检查通过");
  }
}
