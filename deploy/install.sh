#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' "Run this installer with sudo or as root." >&2
  exit 1
fi

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
source_dir="${MYTOKEN_SOURCE_DIR:-$(CDPATH= cd -- "$script_dir/.." && pwd)}"
install_dir="${MYTOKEN_INSTALL_DIR:-/opt/mytoken}"
environment_file="${MYTOKEN_ENV_FILE:-/etc/mytoken/mytoken.env}"
codex_bin="${MYTOKEN_CODEX_BIN:-}"
codex_version="${MYTOKEN_CODEX_VERSION:-0.147.0}"
manage_codex="${MYTOKEN_MANAGE_CODEX:-true}"
build_user="${SUDO_USER:-root}"
skip_tests="${MYTOKEN_SKIP_TESTS:-false}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "Required command is missing: $1" >&2
    exit 1
  fi
}

for command_name in node npm openssl rsync curl systemctl systemd-tmpfiles install runuser \
  groupadd useradd usermod getent sort head sed grep awk mktemp chown chmod cp mv; do
  require_command "$command_name"
done

node_version="$(node --version | sed 's/^v//')"
minimum_node="22.13.0"
if [ "$(printf '%s\n%s\n' "$minimum_node" "$node_version" | sort -V | head -n 1)" != "$minimum_node" ]; then
  printf '%s\n' "Node.js $minimum_node or newer is required; found $node_version" >&2
  exit 1
fi

if [ -z "$codex_bin" ]; then
  codex_bin="$(command -v codex || true)"
fi
installed_codex_version=""
if [ -n "$codex_bin" ] && [ -x "$codex_bin" ]; then
  installed_codex_version="$($codex_bin --version 2>/dev/null | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+)$/\1/' || true)"
fi
if [ "$installed_codex_version" != "$codex_version" ]; then
  if [ "$manage_codex" != "true" ]; then
    printf '%s\n' "Codex $codex_version is required; found ${installed_codex_version:-none}" >&2
    exit 1
  fi
  printf '%s\n' "Installing compatible Codex CLI $codex_version from the official npm package"
  npm install --global "@openai/codex@$codex_version"
  codex_bin="$(command -v codex || true)"
fi
if [ -z "$codex_bin" ] || [ ! -x "$codex_bin" ]; then
  printf '%s\n' "Codex installation completed but the executable is not on PATH" >&2
  exit 1
fi

staging_dir="$(mktemp -d /var/tmp/mytoken-build.XXXXXX)"
cleanup() {
  case "$staging_dir" in
    /var/tmp/mytoken-build.*) rm -rf -- "$staging_dir" ;;
  esac
  if [ -n "${runtime_backup_dir:-}" ]; then
    case "$runtime_backup_dir" in
      /var/tmp/mytoken-runtime-backup.*) rm -rf -- "$runtime_backup_dir" ;;
    esac
  fi
}
trap cleanup EXIT HUP INT TERM

printf '%s\n' "Staging source from $source_dir"
rsync -a \
  --exclude .git --exclude node_modules --exclude coverage \
  --exclude '*.sqlite' --exclude '*.sqlite-wal' --exclude '*.sqlite-shm' \
  "$source_dir/" "$staging_dir/"
chown -R "$build_user":"$build_user" "$staging_dir"

npm_cache="/var/tmp/mytoken-npm-cache-$build_user"
install -d -o "$build_user" -g "$build_user" -m 0700 "$npm_cache"

run_build() {
  runuser -u "$build_user" -- env \
    PATH=/usr/local/bin:/usr/bin:/bin \
    MYTOKEN_CODEX_BIN="$codex_bin" \
    npm_config_cache="$npm_cache" \
    sh -c "cd '$staging_dir' && $1"
}

run_build "npm ci"
if [ "$skip_tests" != "true" ]; then
  run_build "npm run format:check"
  run_build "npm run typecheck"
  run_build "npm run lint"
  run_build "npm test"
  run_build "npm run db:check"
  run_build "npm run codex:check-contract"
fi
run_build "npm run build"

if ! getent group mytoken >/dev/null 2>&1; then
  groupadd --system mytoken
fi
if ! id mytoken-api >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/mytoken/api --shell /usr/sbin/nologin mytoken-api
fi
if ! id mytoken-codex >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/mytoken/codex --shell /usr/sbin/nologin mytoken-codex
fi
usermod -a -G mytoken mytoken-api
usermod -a -G mytoken mytoken-codex

install -m 0644 "$staging_dir/deploy/tmpfiles.d/mytoken.conf" /etc/tmpfiles.d/mytoken.conf
systemd-tmpfiles --create /etc/tmpfiles.d/mytoken.conf
"$staging_dir/deploy/scripts/generate-secrets.sh" /etc/mytoken/secrets

if [ ! -e "$environment_file" ]; then
  environment_tmp="$(mktemp /etc/mytoken/mytoken.env.XXXXXX)"
  cat > "$environment_tmp" <<EOF
NODE_ENV=production
MYTOKEN_VERSION=0.1.0-preview.4
MYTOKEN_HOST=127.0.0.1
MYTOKEN_PORT=8080
MYTOKEN_WEB_ROOT=$install_dir/apps/web/dist
MYTOKEN_DB_PATH=/var/lib/mytoken/api/mytoken.sqlite
MYTOKEN_WORKER_SOCKET=/run/mytoken/worker.sock
MYTOKEN_CODEX_BIN=$codex_bin
MYTOKEN_CODEX_HOME=/var/lib/mytoken/codex
MYTOKEN_CODEX_WORKSPACE=/var/lib/mytoken/workspace
MYTOKEN_SUPPORTED_CODEX_VERSION=$codex_version
MYTOKEN_ALLOW_UNVERIFIED_CODEX_VERSION=false
MYTOKEN_ENABLE_EXPERIMENTAL_TOOL_BRIDGE=true
MYTOKEN_REQUEST_TIMEOUT_MS=120000
MYTOKEN_TOOL_RESULT_TIMEOUT_MS=300000
MYTOKEN_MAX_PENDING_TOOL_CALLS=8
MYTOKEN_MAX_TOOL_RESULT_BYTES=1048576
MYTOKEN_MAX_GLOBAL_CONCURRENCY=1
MYTOKEN_TRUST_PROXY=
MYTOKEN_PROVIDERS_FILE=/etc/mytoken/providers.json
MYTOKEN_ALLOW_INSECURE_PROVIDERS=false
MYTOKEN_PROVIDER_REQUEST_TIMEOUT_MS=120000
EOF
  chown root:mytoken "$environment_tmp"
  chmod 0640 "$environment_tmp"
  mv "$environment_tmp" "$environment_file"
else
  printf '%s\n' "Preserving existing environment file: $environment_file"
fi

for required_key in MYTOKEN_DB_PATH MYTOKEN_WORKER_SOCKET MYTOKEN_CODEX_BIN \
  MYTOKEN_CODEX_HOME MYTOKEN_CODEX_WORKSPACE; do
  if ! grep -q "^$required_key=" "$environment_file"; then
    printf '%s\n' "Existing environment file is missing $required_key" >&2
    exit 1
  fi
done

ensure_env_default() {
  key="$1"
  value="$2"
  if ! grep -q "^$key=" "$environment_file"; then
    printf '%s=%s\n' "$key" "$value" >> "$environment_file"
  fi
}
ensure_env_default MYTOKEN_MAX_GLOBAL_CONCURRENCY 1
ensure_env_default MYTOKEN_TRUST_PROXY ""
ensure_env_default MYTOKEN_PROVIDERS_FILE /etc/mytoken/providers.json
ensure_env_default MYTOKEN_ALLOW_INSECURE_PROVIDERS false
ensure_env_default MYTOKEN_PROVIDER_REQUEST_TIMEOUT_MS 120000

if [ ! -e /etc/mytoken/providers.json ]; then
  install -o root -g mytoken-api -m 0640 \
    "$staging_dir/deploy/providers.example.json" /etc/mytoken/providers.json
fi

api_was_active=false
worker_was_active=false
systemctl is-active --quiet mytoken-api.service && api_was_active=true
systemctl is-active --quiet mytoken-worker.service && worker_was_active=true
if [ "$api_was_active" = "true" ]; then systemctl stop mytoken-api.service; fi
if [ "$worker_was_active" = "true" ]; then systemctl stop mytoken-worker.service; fi

database_path="$(sed -n 's/^MYTOKEN_DB_PATH=//p' "$environment_file" | head -n 1)"
if [ -f "$database_path" ]; then
  backup_dir="/var/lib/mytoken/api/backups"
  install -d -o mytoken-api -g mytoken-api -m 0700 "$backup_dir"
  backup_path="$backup_dir/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  runuser -u mytoken-api -- env MYTOKEN_DB_PATH="$database_path" /usr/bin/env node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.env.MYTOKEN_DB_PATH);
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const row = db.prepare("PRAGMA integrity_check").get();
    db.close();
    if (row.integrity_check !== "ok") process.exit(1);
  '
  cp --preserve=mode,ownership,timestamps "$database_path" "$backup_path"
  runuser -u mytoken-api -- env MYTOKEN_DB_PATH="$backup_path" /usr/bin/env node -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.env.MYTOKEN_DB_PATH, { readOnly: true });
    const row = db.prepare("PRAGMA integrity_check").get();
    db.close();
    if (row.integrity_check !== "ok") process.exit(1);
  '
  printf '%s\n' "Database backup created: $backup_path"
fi

runtime_backup_dir=""
if [ -d "$install_dir" ] && [ -f "$install_dir/package.json" ]; then
  runtime_backup_dir="$(mktemp -d /var/tmp/mytoken-runtime-backup.XXXXXX)"
  rsync -a "$install_dir/" "$runtime_backup_dir/"
fi
install -d -o root -g root -m 0755 "$install_dir"
rsync -a --delete --exclude .git --exclude node_modules --exclude coverage "$staging_dir/" "$install_dir/"
chown -R root:root "$install_dir"
(
  cd "$install_dir"
  npm_config_cache=/var/tmp/mytoken-runtime-npm-cache npm ci --omit=dev --ignore-scripts
)

install -m 0644 "$install_dir/deploy/systemd/mytoken-worker.service" /etc/systemd/system/
install -m 0644 "$install_dir/deploy/systemd/mytoken-api.service" /etc/systemd/system/
install -m 0644 "$install_dir/deploy/systemd/mytoken-update.service" /etc/systemd/system/
install -m 0644 "$install_dir/deploy/systemd/mytoken-update.path" /etc/systemd/system/
install -m 0755 "$install_dir/deploy/bin/mytokenctl" /usr/local/sbin/mytokenctl
install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 \
  "$install_dir/deploy/bin/mytoken-update-runner" /usr/local/libexec/mytoken-update-runner

systemctl daemon-reload
systemctl enable mytoken-worker.service mytoken-api.service mytoken-update.path >/dev/null
systemctl restart mytoken-update.path
systemctl restart mytoken-worker.service
systemctl restart mytoken-api.service

health_ok=false
attempt=1
while [ "$attempt" -le 30 ]; do
  if curl --fail --silent http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
    health_ok=true
    break
  fi
  sleep 1
  attempt=$((attempt + 1))
done

if [ "$health_ok" != "true" ]; then
  printf '%s\n' "MyToken did not become healthy; attempting runtime rollback." >&2
  if [ -n "$runtime_backup_dir" ]; then
    systemctl stop mytoken-api.service mytoken-worker.service || true
    rsync -a --delete "$runtime_backup_dir/" "$install_dir/"
    systemctl daemon-reload
    systemctl restart mytoken-worker.service
    systemctl restart mytoken-api.service
    printf '%s\n' "Previous runtime restored. Inspect: mytokenctl logs all" >&2
  fi
  exit 1
fi

printf '%s\n' "MyToken deployment completed."
printf '%s\n' "Status: mytokenctl status"
printf '%s\n' "First access: ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER"
printf '%s\n' "Then open http://127.0.0.1:8080 and run: sudo mytokenctl bootstrap-token"
