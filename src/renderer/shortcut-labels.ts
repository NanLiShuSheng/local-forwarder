function currentPlatformHint(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  return `${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
}

function usesCommandModifier(platformHint: string | undefined): boolean {
  return platformHint === undefined || /mac|iphone|ipad|ipod/i.test(platformHint);
}

export function shortcutModifierLabel(platformHint: string | undefined = currentPlatformHint()): "⌘" | "Ctrl" {
  return usesCommandModifier(platformHint) ? "⌘" : "Ctrl";
}

export function formatShortcut(key: string, platformHint: string | undefined = currentPlatformHint()): string {
  if (usesCommandModifier(platformHint)) return `⌘${key === "Enter" ? "↵" : key}`;
  return `Ctrl+${key}`;
}

export function isShortcutModifierPressed(event: Pick<KeyboardEvent, "metaKey" | "ctrlKey">): boolean {
  return event.metaKey || event.ctrlKey;
}
