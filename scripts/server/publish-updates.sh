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

echo "Published ${#assets[@]} assets and ${#manifests[@]} manifests to $public_dir"
