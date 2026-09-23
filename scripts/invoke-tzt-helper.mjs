import { execFileSync } from "node:child_process";

export function invokeTzt(nodePath, helperPath, request, options = {}) {
  const output = execFileSync(nodePath, [helperPath], {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15_000,
    ...options,
    input: JSON.stringify(request),
    encoding: "utf8",
  });
  return JSON.parse(output);
}
