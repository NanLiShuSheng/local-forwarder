import { TcpBridgePool } from "../src/core/tcp/tcp-bridge";

const host = process.env.TZT_PROBE_HOST ?? "123.103.83.98";
const port = Number(process.env.TZT_PROBE_PORT ?? "7777");

const cases: Array<{ name: string; query: Record<string, string> }> = [
  { name: "action-only", query: { Action: "3010" } },
  { name: "grid0-empty", query: { Action: "3010", GRID0: "" } },
  { name: "grid0-missing", query: { Action: "3010", GRID0: "/no-such-file-xyz.d=0" } },
  { name: "grid-lowercase", query: { Action: "3010", Grid0: "/no-such-file-xyz.d=0" } },
  { name: "grid-no-digit", query: { Action: "3010", GRID: "/no-such-file-xyz.d=0" } },
  { name: "grid-lowercase-key", query: { Action: "3010", grid: "/no-such-file-xyz.d=0" } },
  { name: "grid-mixed-key", query: { Action: "3010", Grid: "/no-such-file-xyz.d=0" } },
  { name: "grid1-missing", query: { Action: "3010", GRID1: "/no-such-a.d=0" } },
  { name: "grid0-through-grid5", query: {
    Action: "3010",
    GRID0: "/no-such-0.d=0",
    GRID1: "/no-such-1.d=0",
    GRID2: "/no-such-2.d=0",
    GRID3: "/no-such-3.d=0",
    GRID4: "/no-such-4.d=0",
    GRID5: "/no-such-5.d=0",
  } },
  { name: "duplicate-paths", query: { Action: "3010", GRID0: "/no-such-a.d=0\n/no-such-a.d=0" } },
  { name: "invalid-versions", query: { Action: "3010", GRID0: "/no-such-a.d=abc\n/no-such-b.d=-1\n/no-such-c.d=4294967296\n/no-such-d.d=" } },
  { name: "crlf", query: { Action: "3010", GRID0: "/no-such-a.d=0\r\n/no-such-b.d=0\r\n" } },
  { name: "blank-and-malformed-lines", query: { Action: "3010", GRID0: "\n\n/no-such-a.d=0\nnot-a-grid-line\n/no-such-b.d=0\n" } },
  { name: "whitespace-around-lines", query: { Action: "3010", GRID0: " /no-such-a.d=0 \n\t/no-such-b.d=0\t" } },
  { name: "grid-single-missing", query: { Action: "3010", GRID: "/no-such-file-xyz.d=0" } },
  { name: "grid-two-missing", query: { Action: "3010", GRID: "/no-such-a.d=0\n/no-such-b.d=0" } },
  { name: "grid-duplicate-paths", query: { Action: "3010", GRID: "/no-such-a.d=0\n/no-such-a.d=0" } },
  { name: "grid-invalid-versions", query: { Action: "3010", GRID: "/no-such-a.d=abc\n/no-such-b.d=-1\n/no-such-c.d=4294967296\n/no-such-d.d=" } },
  { name: "grid-crlf", query: { Action: "3010", GRID: "/no-such-a.d=0\r\n/no-such-b.d=0\r\n" } },
  { name: "grid-blank-and-malformed-lines", query: { Action: "3010", GRID: "\n\n/no-such-a.d=0\nnot-a-grid-line\n/no-such-b.d=0\n" } },
  { name: "grid-whitespace-around-lines", query: { Action: "3010", GRID: " /no-such-a.d=0 \n\t/no-such-b.d=0\t" } },
  { name: "grid-plus-grid1", query: { Action: "3010", GRID: "/no-such-a.d=0", GRID1: "/no-such-b.d=0" } },
  { name: "grid-plus-grid2", query: { Action: "3010", GRID: "/no-such-a.d=0", GRID2: "/no-such-b.d=0" } },
  { name: "grid-plus-grid0", query: { Action: "3010", GRID: "/no-such-a.d=0", GRID0: "/no-such-b.d=0" } },
  { name: "grid1-through-grid5", query: { Action: "3010", GRID1: "/no-such-1.d=0", GRID2: "/no-such-2.d=0", GRID3: "/no-such-3.d=0", GRID4: "/no-such-4.d=0", GRID5: "/no-such-5.d=0" } },
  { name: "grid-with-bare-cr", query: { Action: "3010", GRID: "/no-such-a.d=0\r/no-such-b.d=0" } },
  { name: "grid-with-path-query", query: { Action: "3010", GRID: "/no-such-a.d?x=1=0" } },
  { name: "grid-with-backslash", query: { Action: "3010", GRID: "\\no-such-a.d=0" } },
  { name: "real-version-match", query: { Action: "3010", GRID: "/zx/index.html.d=2147535" } },
  { name: "real-version-mismatch", query: { Action: "3010", GRID: "/zx/index.html.d=2147536" } },
  { name: "real-version-uppercase-path", query: { Action: "3010", GRID: "/ZX/INDEX.HTML.D=2147535" } },
  { name: "real-version-mixed-match-and-mismatch", query: { Action: "3010", GRID: "/zx/index.html.d=2147535\n/zx/index.html.d=0" } },
  { name: "real-version-extra-equals", query: { Action: "3010", GRID: "/zx/index.html.d=2147535=0" } },
  { name: "real-version-leading-slash", query: { Action: "3010", GRID: "zx/index.html.d=2147535" } },
  { name: "real-version-zero", query: { Action: "3010", GRID: "/zx/index.html.d=0" } },
  { name: "real-version-plus", query: { Action: "3010", GRID: "/zx/index.html.d=+2147535" } },
  { name: "real-version-leading-zeroes", query: { Action: "3010", GRID: "/zx/index.html.d=0002147535" } },
  { name: "real-version-space", query: { Action: "3010", GRID: "/zx/index.html.d= 2147535" } },
  { name: "real-version-trailing-space", query: { Action: "3010", GRID: "/zx/index.html.d=2147535 " } },
  { name: "grid-empty-path", query: { Action: "3010", GRID: "=0" } },
  { name: "grid-slash-only", query: { Action: "3010", GRID: "/=0" } },
  { name: "grid-space-path", query: { Action: "3010", GRID: " =0" } },
  { name: "grid-dot-segments", query: { Action: "3010", GRID: "/./zx/index.html.d=2147535" } },
  { name: "grid-dotdot-segments", query: { Action: "3010", GRID: "/zx/../zx/index.html.d=2147535" } },
  { name: "grid-traversal", query: { Action: "3010", GRID: "/../server.ini=0" } },
  { name: "real-version-minus-zero", query: { Action: "3010", GRID: "/zx/index.html.d=-0" } },
  { name: "real-version-tab-leading", query: { Action: "3010", GRID: "/zx/index.html.d=\t2147535" } },
  { name: "real-version-tab-trailing", query: { Action: "3010", GRID: "/zx/index.html.d=2147535\t" } },
  { name: "real-version-empty-then-valid", query: { Action: "3010", GRID: "/zx/index.html.d=\n/zx/index.html.d=2147535" } },
];

async function main(): Promise<void> {
  const bridge = new TcpBridgePool({ connectTimeoutMs: 10_000, requestTimeoutMs: 15_000 });
  try {
    for (const testCase of cases) {
      try {
        const response = await bridge.request({ host, port }, testCase.query);
        console.log(JSON.stringify({ name: testCase.name, request: testCase.query, response }));
      } catch (error) {
        console.log(JSON.stringify({ name: testCase.name, request: testCase.query, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  } finally {
    await bridge.close();
  }
}

void main();
