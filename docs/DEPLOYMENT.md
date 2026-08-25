# Linux Deployment

## Status

The unit files are authored for Linux/systemd but have not yet been runtime-verified on this macOS development host. Do not label the deployment production-ready until the live Linux checklist passes.

## Users and directories

Create two system users and one narrowly scoped shared group:

```bash
groupadd --system mytoken
useradd --system --home-dir /var/lib/mytoken/api --shell /usr/sbin/nologin mytoken-api
useradd --system --home-dir /var/lib/mytoken/codex --shell /usr/sbin/nologin mytoken-codex
usermod -a -G mytoken mytoken-api
usermod -a -G mytoken mytoken-codex
```

Install the tmpfiles configuration, then create directories:

```bash
install -m 0644 deploy/tmpfiles.d/mytoken.conf /etc/tmpfiles.d/mytoken.conf
systemd-tmpfiles --create /etc/tmpfiles.d/mytoken.conf
```

## Application

Build on Node.js 22.13 or newer:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
install -d -o root -g root -m 0755 /opt/mytoken
```

Copy the repository build to `/opt/mytoken` without `node_modules` development caches or local databases, then run `npm ci --omit=dev` there.

## Configuration

Create `/etc/mytoken/mytoken.env` owned by root and mode `0640`:

```text
NODE_ENV=production
MYTOKEN_VERSION=0.1.0
MYTOKEN_HOST=127.0.0.1
MYTOKEN_PORT=8080
MYTOKEN_WEB_ROOT=/opt/mytoken/apps/web/dist
MYTOKEN_DB_PATH=/var/lib/mytoken/api/mytoken.sqlite
MYTOKEN_WORKER_SOCKET=/run/mytoken/worker.sock
MYTOKEN_CODEX_BIN=/usr/local/bin/codex
MYTOKEN_CODEX_HOME=/var/lib/mytoken/codex
MYTOKEN_CODEX_WORKSPACE=/var/lib/mytoken/workspace
MYTOKEN_REQUEST_TIMEOUT_MS=120000
MYTOKEN_TOOL_RESULT_TIMEOUT_MS=300000
MYTOKEN_MAX_PENDING_TOOL_CALLS=8
MYTOKEN_MAX_TOOL_RESULT_BYTES=1048576
```

Generate secrets as root:

```bash
deploy/scripts/generate-secrets.sh /etc/mytoken/secrets
```

The bootstrap token is not logged. Read it directly on the trusted server, use it once, then restrict or remove the bootstrap credential after initialization.

## Services

```bash
install -m 0644 deploy/systemd/mytoken-worker.service /etc/systemd/system/
install -m 0644 deploy/systemd/mytoken-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mytoken-worker mytoken-api
systemctl status mytoken-worker mytoken-api
```

The API service receives secrets through systemd credentials. The worker does not receive those secrets. The worker owns the Unix socket; the API reaches it through the shared group.

## Verification

Before exposing the service:

```bash
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
npm run db:check
npm run codex:check-contract
npm run doctor
systemd-analyze security mytoken-api.service mytoken-worker.service
```

Verify ownership and modes for the database, Codex home, workspace, secret files, run directory, and worker socket. Confirm that `mytoken-api` cannot read the Codex home and `mytoken-codex` cannot read API credentials or the database.

## Tunnel

Public exposure is optional and disabled by default. If Cloudflare Tunnel is used, enable an additional identity layer for the management console, keep the application Session/CSRF controls, never log Authorization headers, and confirm SSE buffering is disabled. The worker socket must never be routed through the tunnel.
