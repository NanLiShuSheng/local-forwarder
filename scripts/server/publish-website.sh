#!/usr/bin/env bash
set -euo pipefail

source_dir="${1:?usage: publish-website.sh <staging-dir> [public-dir]}"
base_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_dir="${2:-$base_dir/public}"

if [[ ! -s "$source_dir/index.html" || ! -s "$source_dir/favicon.svg" ]]; then
    echo "Website index.html or favicon.svg is missing in: $source_dir" >&2
    exit 1
fi

mkdir -p "$public_dir"
if command -v flock >/dev/null 2>&1; then
    exec 9>"$base_dir/.publish-website.lock"
    flock 9
fi

publish_file() {
    local relative_path="$1"
    local source_file="$source_dir/$relative_path"
    local target_file="$public_dir/$relative_path"
    local temporary_file="$public_dir/.${relative_path//\//_}.tmp.$$"

    mkdir -p "$(dirname "$target_file")"
    cp -f "$source_file" "$temporary_file"
    chmod 0644 "$temporary_file"
    mv -f "$temporary_file" "$target_file"
}

# Publish assets before index.html so visitors never get a page that
# references files which have not arrived yet.
while IFS= read -r relative_path; do
    [[ "$relative_path" == "./index.html" ]] && continue
    publish_file "$relative_path"
done < <(cd "$source_dir" && find . -type f -not -path '*/.*' -print | sort)

publish_file "./index.html"

echo "Published website files to $public_dir"
