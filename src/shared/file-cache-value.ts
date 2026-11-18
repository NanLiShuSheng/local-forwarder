export function decodeFileCacheValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function encodeFileCacheValue(value: string): string {
  try {
    return encodeURI(decodeFileCacheValue(value));
  } catch {
    return value;
  }
}
