import type { StringToolOperation } from "./contracts";

export function applyStringOperation(input: string, operation: StringToolOperation, findText: string, replaceText: string): string {
  switch (operation) {
    case "replace":
      return findText === "" ? input : input.split(findText).join(replaceText);
    case "remove":
      return findText === "" ? input : input.split(findText).join("");
    case "uppercase":
      return input.toUpperCase();
    case "lowercase":
      return input.toLowerCase();
    case "url-encode":
      return encodeURIComponent(input);
    case "url-decode":
      return decodeURIComponent(input);
    case "json-format":
      return JSON.stringify(JSON.parse(input), null, 2);
  }
}
