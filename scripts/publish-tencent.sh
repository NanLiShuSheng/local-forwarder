#!/usr/bin/env bash
set -euo pipefail

artifact_dir="${1:?usage: publish-tencent.sh <artifact-dir> [version]}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

version="${2:-$(node -p "require('./package.json').version")}"
host="${TENCENT_SSH_HOST:?TENCENT_SSH_HOST is required}"
user="${TENCENT_SSH_USER:-deploy}"
key="${TENCENT_SSH_KEY:?TENCENT_SSH_KEY is required}"
release_root="${TENCENT_RELEASE_ROOT:-/srv/local-forwarder-updates}"
server_publish_script="$project_root/scripts/server/publish-updates.sh"

if [[ ! -d "$artifact_dir" ]]; then
    echo "Artifact directory does not exist: $artifact_dir" >&2
    exit 1
fi
if [[ ! -s "$server_publish_script" ]]; then
    echo "Server publish script is missing: $server_publish_script" >&2
    exit 1
fi

manifest_count=0
for manifest in latest.yml latest-mac.yml; do
    if [[ -s "$artifact_dir/$manifest" ]]; then
        manifest_count=$((manifest_count + 1))
    fi
done
if (( manifest_count == 0 )); then
    echo "At least one of latest.yml or latest-mac.yml is required in $artifact_dir" >&2
    exit 1
fi
if [[ -s "$artifact_dir/latest-mac.yml" && ! -s "$artifact_dir/mac-update.json" ]]; then
    echo "mac-update.json is required when latest-mac.yml is present" >&2
    exit 1
fi

staging="$release_root/incoming/${version}-$(date +%Y%m%d%H%M%S)-$$"
ssh_options=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)

ssh "${ssh_options[@]}" "$user@$host" "mkdir -p '$staging'"
rsync -az --progress -e "ssh ${ssh_options[*]}" "$artifact_dir"/ "$user@$host:$staging/"
scp "${ssh_options[@]}" "$server_publish_script" "$user@$host:$staging/.publish-updates.sh"
ssh "${ssh_options[@]}" "$user@$host" "bash '$staging/.publish-updates.sh' '$staging' '$release_root/public' && rm -rf '$staging'"

echo "Published Local Forwarder $version to $release_root/public"
