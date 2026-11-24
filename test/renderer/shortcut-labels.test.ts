import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type ShortcutLabels = {
  formatShortcut: (key: string, platformHint?: string) => string;
  shortcutModifierLabel: (platformHint?: string) => string;
  isShortcutModifierPressed: (event: { metaKey: boolean; ctrlKey: boolean }) => boolean;
};

async function loadShortcutLabels(): Promise<ShortcutLabels> {
  const module = await import("../../src/renderer/shortcut-labels") as unknown as Partial<ShortcutLabels>;
  assert.equal(typeof module.formatShortcut, "function");
  assert.equal(typeof module.shortcutModifierLabel, "function");
  assert.equal(typeof module.isShortcutModifierPressed, "function");
  return module as ShortcutLabels;
}

test("shortcut labels use Command on macOS and Ctrl on Windows", async () => {
  const { formatShortcut, shortcutModifierLabel } = await loadShortcutLabels();

  assert.equal(shortcutModifierLabel("MacIntel"), "⌘");
  assert.equal(shortcutModifierLabel("Win32"), "Ctrl");
  assert.equal(formatShortcut("K", "MacIntel"), "⌘K");
  assert.equal(formatShortcut("K", "Win32"), "Ctrl+K");
  assert.equal(formatShortcut("Enter", "MacIntel"), "⌘↵");
  assert.equal(formatShortcut("Enter", "Win32"), "Ctrl+Enter");
});

test("shortcut modifier detection accepts Ctrl for Windows and Command for macOS", async () => {
  const { isShortcutModifierPressed } = await loadShortcutLabels();

  assert.equal(isShortcutModifierPressed({ metaKey: false, ctrlKey: true }), true);
  assert.equal(isShortcutModifierPressed({ metaKey: true, ctrlKey: false }), true);
  assert.equal(isShortcutModifierPressed({ metaKey: false, ctrlKey: false }), false);
});

test("custom shortcut handlers use the shared cross-platform modifier detection", async () => {
  const files = [
    "src/renderer/App.tsx",
    "src/renderer/components/RequestPage.tsx",
    "src/renderer/components/LocalCachePage.tsx",
    "src/renderer/components/LocalVariablesPage.tsx",
  ];
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));

  for (const source of sources) assert.match(source, /isShortcutModifierPressed\(event\)/);
});

test("production shortcut hints do not hard-code the macOS Command symbol", async () => {
  const files = [
    "src/renderer/App.tsx",
    "src/renderer/components/RequestPage.tsx",
    "src/renderer/components/LocalVariablesPage.tsx",
    "src/renderer/components/WorkspaceChrome.tsx",
    "src/renderer/components/WorkspacePages.tsx",
    "src/renderer/workspace-navigation.ts",
  ];
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));

  for (const source of sources) assert.doesNotMatch(source, /⌘/);
});
