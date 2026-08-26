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
environment_preexisting=false
if [ -e "$environment_file" ]; then environment_preexisting=true; fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s\n' "Required command is missing: $1" >&2
    exit 1
  fi
}

for command_name in node npm openssl rsync curl systemctl systemd-tmpfiles install runuser \
  groupadd useradd usermod getent id sort head sed grep awk mktemp chown chmod cp mv; do
  require_command "$command_name"
done

build_group="$(id -gn "$build_user")"

release_version="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(p.version)' "$source_dir/packages/cli/package.json")"
if ! printf '%s' "$release_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$'; then
  printf '%s\n' "Invalid release version in $source_dir/packages/cli/package.json" >&2
  exit 1
fi

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
  exit_status=$?
  if [ "$exit_status" -ne 0 ] && [ "${transaction_active:-false}" = "true" ]; then
    printf '%s\n' "Deployment failed; restoring previous runtime and environment." >&2
    set +e
    systemctl stop mytoken-api.service mytoken-worker.service mytoken-update.path >/dev/null 2>&1
    if [ -n "${runtime_backup_dir:-}" ]; then
      rsync -a --delete "$runtime_backup_dir/" "$install_dir/"
      for unit in mytoken-worker.service mytoken-api.service mytoken-update.service mytoken-update.path; do
        if [ -f "$install_dir/deploy/systemd/$unit" ]; then
          install -m 0644 "$install_dir/deploy/systemd/$unit" "/etc/systemd/system/$unit"
        fi
      done
      if [ -f "$install_dir/deploy/bin/mytokenctl" ]; then
        install -m 0755 "$install_dir/deploy/bin/mytokenctl" /usr/local/sbin/mytokenctl
      fi
      if [ -f "$install_dir/deploy/bin/mytoken-update-runner" ]; then
        install -d -m 0755 /usr/local/libexec
        install -m 0755 "$install_dir/deploy/bin/mytoken-update-runner" /usr/local/libexec/mytoken-update-runner
      fi
    fi
    if [ -n "${environment_backup_file:-}" ] && [ -s "$environment_backup_file" ]; then
      cp --preserve=mode,ownership,timestamps "$environment_backup_file" "$environment_file"
    elif [ "${environment_preexisting:-false}" != "true" ]; then
      rm -f -- "$environment_file"
    fi
    systemctl daemon-reload
    if [ "${worker_was_enabled:-false}" = "true" ]; then
      systemctl enable mytoken-worker.service >/dev/null 2>&1
    else
      systemctl disable mytoken-worker.service >/dev/null 2>&1
    fi
    if [ "${api_was_enabled:-false}" = "true" ]; then
      systemctl enable mytoken-api.service >/dev/null 2>&1
    else
      systemctl disable mytoken-api.service >/dev/null 2>&1
    fi
    if [ "${update_path_was_enabled:-false}" = "true" ]; then
      systemctl enable mytoken-update.path >/dev/null 2>&1
    else
      systemctl disable mytoken-update.path >/dev/null 2>&1
    fi
    if [ "${update_path_was_active:-false}" = "true" ]; then
      systemctl start mytoken-update.path
    fi
    if [ "${worker_was_active:-false}" = "true" ]; then systemctl start mytoken-worker.service; fi
    if [ "${api_was_active:-false}" = "true" ]; then systemctl start mytoken-api.service; fi
    transaction_active=false
    if [ -n "${runtime_backup_dir:-}" ] || [ -n "${environment_backup_file:-}" ]; then
      printf '%s\n' "Previous runtime and environment restored." >&2
    else
      printf '%s\n' "Fresh install stopped; non-secret system users and directories remain for a safe retry." >&2
    fi
  fi
  case "$staging_dir" in
    /var/tmp/mytoken-build.*) rm -rf -- "$staging_dir" ;;
  esac
  if [ -n "${runtime_backup_dir:-}" ]; then
    case "$runtime_backup_dir" in
      /var/tmp/mytoken-runtime-backup.*) rm -rf -- "$runtime_backup_dir" ;;
    esac
  fi
  if [ -n "${environment_backup_file:-}" ]; then
    case "$environment_backup_file" in
      /var/tmp/mytoken-env-backup.*) rm -f -- "$environment_backup_file" ;;
    esac
  fi
  exit "$exit_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' "Staging source from $source_dir"
rsync -a \
  --exclude .git --exclude node_modules --exclude coverage --exclude dist \
  --exclude '*.tsbuildinfo' \
  --exclude '*.sqlite' --exclude '*.sqlite-wal' --exclude '*.sqlite-shm' \
  "$source_dir/" "$staging_dir/"
chown -R "$build_user":"$build_group" "$staging_dir"

npm_cache="/var/tmp/mytoken-npm-cache-$build_user"
install -d -o "$build_user" -g "$build_group" -m 0700 "$npm_cache"

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

web_dist="$staging_dir/apps/web/dist"
if [ ! -s "$web_dist/index.html" ] || [ ! -s "$web_dist/version.json" ]; then
  printf '%s\n' "Frontend build is incomplete: index.html and version.json are required" >&2
  exit 1
fi
web_version="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(p.version || ""))' "$web_dist/version.json")"
if [ "$web_version" != "$release_version" ]; then
  printf '%s\n' "Frontend release mismatch: expected $release_version, found ${web_version:-none}" >&2
  exit 1
fi
web_asset="$(sed -n 's/.*src="\/\(assets\/index-[^"]*\.js\)".*/\1/p' "$web_dist/index.html" | head -n 1)"
if [ -z "$web_asset" ] || [ ! -s "$web_dist/$web_asset" ]; then
  printf '%s\n' "Frontend build is missing its entry JavaScript asset" >&2
  exit 1
fi

if ! getent group mytoken >/dev/null 2>&1; then
  groupadd --system mytoken
fi
if ! getent group mytoken-api >/dev/null 2>&1; then
  groupadd --system mytoken-api
fi
if ! getent group mytoken-codex >/dev/null 2>&1; then
  groupadd --system mytoken-codex
fi
if ! id mytoken-api >/dev/null 2>&1; then
  useradd --system --gid mytoken-api --home-dir /var/lib/mytoken/api \
    --shell /usr/sbin/nologin mytoken-api
fi
if ! id mytoken-codex >/dev/null 2>&1; then
  useradd --system --gid mytoken-codex --home-dir /var/lib/mytoken/codex \
    --shell /usr/sbin/nologin mytoken-codex
fi
usermod -g mytoken-api mytoken-api
usermod -g mytoken-codex mytoken-codex
usermod -a -G mytoken mytoken-api
usermod -a -G mytoken mytoken-codex

install -m 0644 "$staging_dir/deploy/tmpfiles.d/mytoken.conf" /etc/tmpfiles.d/mytoken.conf
systemd-tmpfiles --create /etc/tmpfiles.d/mytoken.conf
"$staging_dir/deploy/scripts/generate-secrets.sh" /etc/mytoken/secrets

if [ ! -e "$environment_file" ]; then
  environment_tmp="$(mktemp /etc/mytoken/mytoken.env.XXXXXX)"
  cat > "$environment_tmp" <<EOF
NODE_ENV=production
MYTOKEN_VERSION=$release_version
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

set_env_value() {
  key="$1"
  value="$2"
  update_tmp="$(mktemp /etc/mytoken/mytoken.env.update.XXXXXX)"
  awk -v wanted="$key" -v replacement="$value" '
    BEGIN { found = 0 }
    $0 ~ "^" wanted "=" { print wanted "=" replacement; found = 1; next }
    { print }
    END { if (!found) print wanted "=" replacement }
  ' "$environment_file" > "$update_tmp"
  chown root:mytoken "$update_tmp"
  chmod 0640 "$update_tmp"
  mv "$update_tmp" "$environment_file"
}

# Snapshot both mutable deployment surfaces before changing either one.
runtime_backup_dir=""
environment_backup_file=""
transaction_active=false
api_was_active=false
worker_was_active=false
update_path_was_active=false
api_was_enabled=false
worker_was_enabled=false
update_path_was_enabled=false
if [ "$environment_preexisting" = "true" ]; then
  environment_backup_file="$(mktemp /var/tmp/mytoken-env-backup.XXXXXX)"
  cp --preserve=mode,ownership,timestamps "$environment_file" "$environment_backup_file"
fi
if [ -d "$install_dir" ] && [ -f "$install_dir/package.json" ]; then
  runtime_backup_dir="$(mktemp -d /var/tmp/mytoken-runtime-backup.XXXXXX)"
  rsync -a "$install_dir/" "$runtime_backup_dir/"
fi
systemctl is-active --quiet mytoken-api.service && api_was_active=true
systemctl is-active --quiet mytoken-worker.service && worker_was_active=true
systemctl is-active --quiet mytoken-update.path && update_path_was_active=true
systemctl is-enabled --quiet mytoken-api.service && api_was_enabled=true
systemctl is-enabled --quiet mytoken-worker.service && worker_was_enabled=true
systemctl is-enabled --quiet mytoken-update.path && update_path_was_enabled=true
transaction_active=true

# Release-derived values must follow the deployed runtime instead of staying
# frozen at the first installation. Operator-owned policy values remain intact.
set_env_value MYTOKEN_VERSION "$release_version"
set_env_value MYTOKEN_WEB_ROOT "$install_dir/apps/web/dist"
set_env_value MYTOKEN_CODEX_BIN "$codex_bin"
set_env_value MYTOKEN_SUPPORTED_CODEX_VERSION "$codex_version"

if [ ! -e /etc/mytoken/providers.json ]; then
  install -o root -g mytoken-api -m 0640 \
    "$staging_dir/deploy/providers.example.json" /etc/mytoken/providers.json
fi

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
  printf '%s\n' "MyToken did not become healthy; inspect: mytokenctl logs all" >&2
  exit 1
fi

version_value() {
  node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(String(p.version || p.apiVersion || p.currentVersion || ""))'
}
deployed_version="$(node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(p.version || ""))' "$install_dir/packages/cli/package.json")"
configured_version="$(sed -n 's/^MYTOKEN_VERSION=//p' "$environment_file" | head -n 1)"
if [ "$deployed_version" != "$release_version" ] || [ "$configured_version" != "$release_version" ]; then
  printf '%s\n' "Release state mismatch: source=$release_version deployed=${deployed_version:-none} configured=${configured_version:-none}" >&2
  exit 1
fi
api_version="$(curl --fail --silent --max-time 10 http://127.0.0.1:8080/versionz | version_value)"
if [ "$api_version" != "$release_version" ]; then
  printf '%s\n' "API release mismatch: expected $release_version, found ${api_version:-none}" >&2
  exit 1
fi
served_web_version="$(curl --fail --silent --max-time 10 http://127.0.0.1:8080/version.json | version_value)"
if [ "$served_web_version" != "$release_version" ]; then
  printf '%s\n' "Served UI release mismatch: expected $release_version, found ${served_web_version:-none}" >&2
  exit 1
fi
served_index="$staging_dir/served-index.html"
served_headers="$staging_dir/served-index.headers"
curl --fail --silent --max-time 10 -D "$served_headers" \
  'http://127.0.0.1:8080/?deploy-check=1' -o "$served_index"
if ! grep -Eiq '^cache-control:.*no-store' "$served_headers"; then
  printf '%s\n' "Served UI entry is missing Cache-Control: no-store" >&2
  exit 1
fi
served_asset="$(sed -n 's/.*src="\/\(assets\/index-[^"]*\.js\)".*/\1/p' "$served_index" | head -n 1)"
if [ -z "$served_asset" ] || ! curl --fail --silent --max-time 10 \
  "http://127.0.0.1:8080/$served_asset" | grep -Fq "$release_version"; then
  printf '%s\n' "Served UI entry asset does not contain release $release_version" >&2
  exit 1
fi

transaction_active=false

printf '%s\n' "MyToken deployment completed."
printf '%s\n' "Source version: $release_version"
printf '%s\n' "Web root: $install_dir/apps/web/dist"
printf '%s\n' "Web asset: $served_asset"
printf '%s\n' "Status: mytokenctl status"
printf '%s\n' "First access: ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER"
printf '%s\n' "Then open http://127.0.0.1:8080 and run: sudo mytokenctl bootstrap-token"
