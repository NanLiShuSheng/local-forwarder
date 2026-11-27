#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host="${TENCENT_SSH_HOST:?TENCENT_SSH_HOST is required}"
user="${TENCENT_SSH_USER:-deploy}"
key="${TENCENT_SSH_KEY:?TENCENT_SSH_KEY is required}"
deploy_root="${UMAMI_DEPLOY_ROOT:-/srv/local-forwarder-umami}"
staging="$deploy_root/incoming/umami-$(date +%Y%m%d%H%M%S)-$$"

for file in docker-compose.yml Caddyfile.example .env.example; do
    if [[ ! -s "$project_root/deploy/umami/$file" ]]; then
        echo "Umami deployment file is missing: deploy/umami/$file" >&2
        exit 1
    fi
done
if [[ ! -s "$key" ]]; then
    echo "SSH key does not exist or is empty: $key" >&2
    exit 1
fi

ssh_options=(-i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new)

echo "Uploading Umami deployment files to $user@$host:$staging"
ssh "${ssh_options[@]}" "$user@$host" "mkdir -p '$staging'"
rsync -az --progress \
    -e "ssh ${ssh_options[*]}" \
    "$project_root/deploy/umami/docker-compose.yml" \
    "$project_root/deploy/umami/Caddyfile.example" \
    "$project_root/deploy/umami/.env.example" \
    "$user@$host:$staging/"

ssh "${ssh_options[@]}" "$user@$host" "bash -s -- '$deploy_root' '$staging'" <<'REMOTE'
set -euo pipefail

deploy_root="$1"
staging="$2"
env_tmp="$deploy_root/.env.tmp.$$"

trap 'rm -rf "$staging"; rm -f "$env_tmp"' EXIT

install -d -m 0755 "$deploy_root"
install -m 0644 "$staging/docker-compose.yml" "$deploy_root/docker-compose.yml"
install -m 0644 "$staging/Caddyfile.example" "$deploy_root/Caddyfile.example"
install -m 0644 "$staging/.env.example" "$deploy_root/.env.example"

if ! command -v docker >/dev/null 2>&1; then
    echo "docker is not installed on the server" >&2
    exit 1
fi
docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then
    if sudo -n docker info >/dev/null 2>&1; then
        docker_cmd=(sudo -n docker)
    else
        echo "docker is not accessible by $user and passwordless sudo is unavailable" >&2
        exit 1
    fi
fi
if ! "${docker_cmd[@]}" compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is not available on the server" >&2
    exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required on the server for the health check" >&2
    exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
    echo "openssl is required on the server to generate deployment secrets" >&2
    exit 1
fi

if [[ ! -s "$deploy_root/.env" ]]; then
    umask 077
    {
        printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)"
        printf 'UMAMI_APP_SECRET=%s\n' "$(openssl rand -hex 32)"
        printf 'UMAMI_TWO_FACTOR_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)"
        printf 'UMAMI_IMAGE=umamisoftware/umami:3.5.0\n'
    } > "$env_tmp"
    chmod 0600 "$env_tmp"
    mv "$env_tmp" "$deploy_root/.env"
    echo "Generated $deploy_root/.env"
else
    chmod 0600 "$deploy_root/.env"
    for key in POSTGRES_PASSWORD UMAMI_APP_SECRET; do
        if ! grep -q "^${key}=." "$deploy_root/.env"; then
            echo "$deploy_root/.env is missing $key; restore the existing value instead of regenerating it" >&2
            exit 1
        fi
    done
    if ! grep -q '^UMAMI_TWO_FACTOR_ENCRYPTION_KEY=.' "$deploy_root/.env"; then
        printf 'UMAMI_TWO_FACTOR_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" >> "$deploy_root/.env"
        echo "Added missing UMAMI_TWO_FACTOR_ENCRYPTION_KEY to $deploy_root/.env"
    fi
    echo "Reusing existing $deploy_root/.env"
fi

cd "$deploy_root"
"${docker_cmd[@]}" compose up -d

healthy=0
for _attempt in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:3000/api/heartbeat >/dev/null 2>&1 \
        && "${docker_cmd[@]}" compose exec -T database pg_isready -U umami -d umami >/dev/null 2>&1; then
        healthy=1
        break
    fi
    sleep 2
done

"${docker_cmd[@]}" compose ps
if (( healthy == 0 )); then
    echo "Umami or PostgreSQL did not become healthy after 30 checks" >&2
    "${docker_cmd[@]}" compose logs --tail=80 umami database >&2 || true
    exit 1
fi

echo "Umami is healthy on 127.0.0.1:3000"
echo "Caddy template: $deploy_root/Caddyfile.example"
REMOTE

cat <<EOF

Containers are running. Caddy was not modified.
Next steps:
  1. Add the site block from $deploy_root/Caddyfile.example to the production Caddyfile.
  2. Replace REPLACE_WITH_CADDY_PASSWORD_HASH using: caddy hash-password --plaintext '<dashboard-password>'
  3. Validate and reload Caddy:
       caddy validate --config /etc/caddy/Caddyfile
       systemctl reload caddy
  4. Open https://analytics.finbr.asia, change the default admin password, create the Local Forwarder website, and copy its Website ID.
  5. Set USAGE_ANALYTICS_WEBSITE_ID in electron/usage-analytics.ts and rebuild the app.
EOF
