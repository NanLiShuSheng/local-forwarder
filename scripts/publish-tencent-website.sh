#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
website_dir="$project_root/website"
host="${TENCENT_SSH_HOST:?TENCENT_SSH_HOST is required}"
user="${TENCENT_SSH_USER:-deploy}"
key="${TENCENT_SSH_KEY:?TENCENT_SSH_KEY is required}"
release_root="${TENCENT_RELEASE_ROOT:-/srv/local-forwarder-updates}"
server_publish_script="$project_root/scripts/server/publish-website.sh"

if [[ ! -s "$website_dir/index.html" || ! -s "$website_dir/favicon.svg" ]]; then
    echo "Website index.html or favicon.svg is missing in $website_dir" >&2
    exit 1
fi
if [[ ! -s "$server_publish_script" ]]; then
    echo "Website publish script is missing: $server_publish_script" >&2
    exit 1
fi

staging="$release_root/incoming/website-$(date +%Y%m%d%H%M%S)-$$"
ssh_options=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)

ssh "${ssh_options[@]}" "$user@$host" "mkdir -p '$staging'"
rsync -az --delete --progress -e "ssh ${ssh_options[*]}" "$website_dir"/ "$user@$host:$staging/"
scp "${ssh_options[@]}" "$server_publish_script" "$user@$host:$staging/.publish-website.sh"
ssh "${ssh_options[@]}" "$user@$host" "bash '$staging/.publish-website.sh' '$staging' '$release_root/public' && rm -rf '$staging'"

echo "Published website files to $release_root/public"
