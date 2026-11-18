#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?usage: publish-updates.sh <staging-dir> [public-dir]}"
base_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_dir="${2:-$base_dir/public}"

if [[ ! -d "$source_dir" ]]; then
    echo "Staging directory does not exist: $source_dir" >&2
    exit 1
fi

manifests=()
for manifest in latest.yml latest-mac.yml; do
    if [[ -e "$source_dir/$manifest" ]]; then
        if [[ ! -s "$source_dir/$manifest" ]]; then
            echo "Empty update manifest: $source_dir/$manifest" >&2
            exit 1
        fi
        manifests+=("$manifest")
    fi
done
if (( ${#manifests[@]} == 0 )); then
    echo "No update manifest found in: $source_dir" >&2
    exit 1
fi

for manifest in "${manifests[@]}"; do
    while IFS= read -r asset; do
        [[ -z "$asset" ]] && continue
        case "$asset" in
            http://*|https://*) continue ;;
        esac
        if [[ ! -f "$source_dir/$asset" ]]; then
            echo "Manifest $manifest references missing asset: $asset" >&2
            exit 1
        fi
    done < <(awk '/^[[:space:]]*(path|url):[[:space:]]*/ { sub(/^[^:]+:[[:space:]]*/, ""); gsub(/["'\'']/, ""); print }' "$source_dir/$manifest")
done

mkdir -p "$public_dir"
if command -v flock >/dev/null 2>&1; then
    exec 9>"$base_dir/.publish.lock"
    flock 9
fi

shopt -s nullglob
assets=(
    "$source_dir"/*.exe
    "$source_dir"/*.exe.blockmap
    "$source_dir"/*.zip
    "$source_dir"/*.zip.blockmap
    "$source_dir"/*.dmg
)
if [[ -f "$source_dir/mac-update.json" ]]; then
    assets+=("$source_dir/mac-update.json")
fi

if (( ${#assets[@]} == 0 )); then
    echo "No release assets found in: $source_dir" >&2
    exit 1
fi

for asset in "${assets[@]}"; do
    name="$(basename "$asset")"
    temporary="$public_dir/.${name}.tmp.$$"
    cp -f "$asset" "$temporary"
    chmod 0644 "$temporary"
    mv -f "$temporary" "$public_dir/$name"
done

for manifest in "${manifests[@]}"; do
    temporary="$public_dir/.${manifest}.tmp.$$"
    cp -f "$source_dir/$manifest" "$temporary"
    chmod 0644 "$temporary"
    mv -f "$temporary" "$public_dir/$manifest"
done

keep_file="$(mktemp "${TMPDIR:-/tmp}/local-forwarder-keep.XXXXXX")"
trap 'rm -f "$keep_file"' EXIT
printf '%s\n' latest.yml latest-mac.yml mac-update.json >> "$keep_file"

for manifest in latest.yml latest-mac.yml; do
    manifest_path="$public_dir/$manifest"
    [[ -f "$manifest_path" ]] || continue
    while IFS= read -r asset; do
        [[ -z "$asset" ]] && continue
        case "$asset" in
            http://*|https://*) continue ;;
        esac
        name="${asset##*/}"
        printf '%s\n' "$name" >> "$keep_file"
        case "$name" in
            *.exe|*.zip) printf '%s\n' "$name.blockmap" >> "$keep_file" ;;
        esac
    done < <(awk '/^[[:space:]]*(path|url):[[:space:]]*/ { sub(/^[^:]+:[[:space:]]*/, ""); gsub(/["'\'']/, ""); print }' "$manifest_path")
done

if [[ -f "$public_dir/mac-update.json" ]]; then
    while IFS= read -r name; do
        [[ -n "$name" ]] && printf '%s\n' "$name" >> "$keep_file"
    done < <(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+\.dmg"' "$public_dir/mac-update.json" \
        | sed -E 's/.*"([^"]+\.dmg)".*/\1/')
fi

sort -u -o "$keep_file" "$keep_file"
pruned=0
shopt -s nullglob
for existing in "$public_dir"/Local-Forwarder-*; do
    [[ -f "$existing" ]] || continue
    name="${existing##*/}"
    if ! grep -Fqx "$name" "$keep_file"; then
        rm -f -- "$existing"
        pruned=$((pruned + 1))
    fi
done

echo "Published ${#assets[@]} assets and ${#manifests[@]} manifests to $public_dir"
echo "Pruned $pruned stale release assets from $public_dir"
