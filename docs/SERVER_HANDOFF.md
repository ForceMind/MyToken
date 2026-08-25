# Server Deployment and Development Handoff

This guide assumes an OpenCloudOS/RHEL-compatible server, a normal SSH development account, and sudo access. Keep the editable source tree separate from the root-owned runtime copy.

## 1. Publish or transfer the branch

The implemented branch is `codex/feat-mytoken-v0-1`. It must exist on the server before Codex can continue there.

Preferred workflow:

```bash
# On the current development machine, after authorization to publish:
git push -u origin codex/feat-mytoken-v0-1

# On the server:
sudo install -d -o "$USER" -g "$USER" -m 0750 /srv/mytoken-src
git clone --branch codex/feat-mytoken-v0-1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
```

If the branch must not be pushed, transfer the Git bundle instead:

```bash
# Current development machine
git bundle create mytoken-v0.1.bundle codex/feat-mytoken-v0-1
scp mytoken-v0.1.bundle YOUR_USER@YOUR_SERVER:/tmp/

# Server
git clone /tmp/mytoken-v0.1.bundle /srv/mytoken-src
cd /srv/mytoken-src
git switch codex/feat-mytoken-v0-1
```

The repository is Apache-2.0 licensed, but confirm the intended GitHub repository visibility before pushing.

## 2. Install prerequisites

Required:

- Node.js 22.13 or newer
- npm
- Git, curl, openssl, rsync
- systemd
- Codex CLI `0.147.0` for the currently pinned protocol contract

Verify:

```bash
node --version
npm --version
systemctl --version
git --version
openssl version
```

Install or update Codex using the official installer:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex --version
command -v codex
```

The systemd worker uses `/usr/local/bin:/usr/bin:/bin`. If `command -v codex` reports a per-user path, install an administrator-approved copy or symlink at `/usr/local/bin/codex`, then set `MYTOKEN_CODEX_BIN=/usr/local/bin/codex`.

Do not copy your development account's `~/.codex/auth.json` into the service home. MyToken performs a separate server-service login through its management page.

## 3. Verify and build the source tree

```bash
cd /srv/mytoken-src
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run db:check
npm run codex:check-contract
npm run doctor
```

The contract check must report exactly the pinned Codex version and SHA-256. Do not enable the unverified-version override for deployment.

## 4. Create service identities

```bash
sudo groupadd --system mytoken || true
sudo useradd --system --home-dir /var/lib/mytoken/api \
  --shell /usr/sbin/nologin mytoken-api || true
sudo useradd --system --home-dir /var/lib/mytoken/codex \
  --shell /usr/sbin/nologin mytoken-codex || true
sudo usermod -a -G mytoken mytoken-api
sudo usermod -a -G mytoken mytoken-codex
```

Install tmpfiles rules and create directories:

```bash
sudo install -m 0644 deploy/tmpfiles.d/mytoken.conf /etc/tmpfiles.d/mytoken.conf
sudo systemd-tmpfiles --create /etc/tmpfiles.d/mytoken.conf
```

## 5. Stage the runtime copy

The running services use `/opt/mytoken`; Codex development uses `/srv/mytoken-src`.

```bash
sudo install -d -o root -g root -m 0755 /opt/mytoken
sudo rsync -a \
  --exclude .git --exclude node_modules --exclude coverage \
  /srv/mytoken-src/ /opt/mytoken/
cd /opt/mytoken
sudo npm ci --omit=dev --ignore-scripts
```

The build command must run in `/srv/mytoken-src` before staging so `apps/api/dist`, `apps/worker/dist`, and `apps/web/dist` are present.

## 6. Configure secrets and environment

Generate service secrets:

```bash
cd /opt/mytoken
sudo ./deploy/scripts/generate-secrets.sh /etc/mytoken/secrets
```

Create `/etc/mytoken/mytoken.env`:

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
MYTOKEN_SUPPORTED_CODEX_VERSION=0.147.0
MYTOKEN_ALLOW_UNVERIFIED_CODEX_VERSION=false
MYTOKEN_ENABLE_EXPERIMENTAL_TOOL_BRIDGE=true
MYTOKEN_REQUEST_TIMEOUT_MS=120000
MYTOKEN_TOOL_RESULT_TIMEOUT_MS=300000
MYTOKEN_MAX_PENDING_TOOL_CALLS=8
MYTOKEN_MAX_TOOL_RESULT_BYTES=1048576
```

```bash
sudo chown root:mytoken /etc/mytoken/mytoken.env
sudo chmod 0640 /etc/mytoken/mytoken.env
```

Do not place the Session Secret, Key Pepper, Bootstrap Token, Codex Token, or Cloudflare Token in this environment file.

## 7. Install and start services

The shortest supported path performs the build, checks, service-user setup, runtime staging, unit installation, restart, and health wait:

```bash
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

The manual commands below remain useful for auditing or repairing individual steps.

```bash
sudo install -m 0644 deploy/systemd/mytoken-worker.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/mytoken-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mytoken-worker mytoken-api
sudo systemctl status --no-pager mytoken-worker mytoken-api
```

Inspect redacted operational logs only:

```bash
sudo journalctl -u mytoken-worker -u mytoken-api -n 100 --no-pager
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
```

Never paste `auth.json`, secret-file contents, the Bootstrap Token, device code, Session Cookie, or MyToken Key into Codex prompts or issue reports.

## 8. Initialize through an SSH tunnel

Keep port 8080 private for the first deployment. From your local computer:

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

Open `http://127.0.0.1:8080` locally. On the server, read the Bootstrap Token once:

```bash
sudo cat /etc/mytoken/secrets/bootstrap-token
```

Use it to create the administrator, then open **Codex 连接**, start device-code login, and complete the official browser flow. The official documentation recommends device-code login on headless machines.

After initialization, remove the Bootstrap credential from the API unit and delete its file only after confirming recovery/backup procedures. Until that hardening step is implemented and verified, keep it root-only at mode `0600`; database state prevents reuse.

## 9. Create and test a client key

In **API Keys**:

1. Create a short-lived test key.
2. Select a model shown by the server.
3. Enable client tools only for OpenClaw.
4. Copy the full key once and store it in the client's secret manager.

Verify locally on the server:

```bash
curl http://127.0.0.1:8080/v1/models \
  -H "Authorization: Bearer MYTOKEN_KEY"
```

Do not put the real key into shell history. Prefer an environment variable or a protected file and clear it after the test.

## 10. Continue development with Codex on the server

Run development Codex as your normal SSH account, not as `mytoken-api`, `mytoken-codex`, or root:

```bash
cd /srv/mytoken-src
codex
```

Start the server task with:

```text
Read MASTER_PLAN.md, PROJECT_STATE.md, README.md, docs/THREAT_MODEL.md,
docs/CODEX_CONTRACT.md, and the latest git log. Continue MyToken V0.1 from
the current branch. Preserve the service CODEX_HOME boundary. Run all relevant
checks before committing. Do not push or deploy without explicit approval.
```

The new Codex task will not automatically inherit this conversation. Repository documents, tests, and commits are the durable handoff.

## 11. Redeploy after development

```bash
cd /srv/mytoken-src
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm run db:check
npm run codex:check-contract

sudo systemctl stop mytoken-api mytoken-worker
sudo rsync -a --exclude .git --exclude node_modules --exclude coverage ./ /opt/mytoken/
cd /opt/mytoken
sudo npm ci --omit=dev --ignore-scripts
sudo systemctl start mytoken-worker mytoken-api
sudo systemctl status --no-pager mytoken-worker mytoken-api
```

Back up `/var/lib/mytoken/api/mytoken.sqlite` safely before applying future schema migrations. Do not back up the Codex home by default.
