# Terminal Operations

[English](OPERATIONS.md) | [简体中文](OPERATIONS.zh-CN.md)

The one-click installer places `mytokenctl` at `/usr/local/sbin/mytokenctl`. Run read-only commands as your normal SSH user. Commands that change service state or read protected files request sudo.

## Install or upgrade

Use the checked-out immutable GitHub tag:

```bash
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

The installer:

1. validates Node, npm, Codex, systemd, OpenSSL, and rsync;
2. copies source to a temporary build directory;
3. runs install, formatting, type, lint, tests, DB and Codex contract checks;
4. builds API, worker, and web artifacts;
5. creates missing service users, directories, and Secrets without overwriting existing ones;
6. stops existing services and creates a pre-deploy database backup;
7. stages `/opt/mytoken`, installs production dependencies, units, and `mytokenctl`;
8. restarts services, validates `/healthz`, and requires the source, deployed package, configured environment, `/versionz`, `/version.json`, and served UI entry to report the same release.

Set `MYTOKEN_SKIP_TESTS=true` only for emergency diagnostics, never for a normal release.

## Common commands

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl version-check
mytokenctl codex-status
mytokenctl permissions
```

The web console checks the dedicated service login before offering a login flow. To perform that login directly in the server terminal:

```bash
sudo mytokenctl codex-login
```

This login belongs to `mytoken-codex` and its dedicated `CODEX_HOME`. A login under root or another Unix user's home is intentionally not reused because that would break the credential boundary.

External model providers:

```bash
sudo mytokenctl provider-status
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-reload
```

The same settings are available under **System → Model Providers**. The interactive `provider-set` command disables terminal echo while reading the upstream API key. Provider keys are stored under `/var/lib/mytoken/api/provider-secrets` and are readable only by `mytoken-api`. See [Model Providers](PROVIDERS.md).

Service control:

```bash
sudo mytokenctl start
sudo mytokenctl stop
sudo mytokenctl restart
```

Logs:

```bash
mytokenctl logs all
mytokenctl logs api
mytokenctl logs worker
```

Database:

```bash
mytokenctl db-check
sudo mytokenctl backup
```

First initialization only:

```bash
sudo mytokenctl bootstrap-token
```

Do not paste the displayed Bootstrap Token, device code, Session Cookie, MyToken Key, or Codex credential into logs, chat, tickets, or shell scripts.

## Deploy a newer source checkout

### Management-console update

After `mytoken-update.path` is installed, open **System → System Update**, review the GitHub tag, and click **Update to latest**. The browser only creates an authenticated, CSRF-protected update marker. A fixed root-owned systemd oneshot verifies the trusted GitHub origin, fetches release tags, validates the tag against `packages/cli/package.json`, checks out the immutable tag, runs the rollback-capable installer, and writes a read-only status file for the console. It does not execute npm.

The page cannot submit a repository, Git ref, package name, command, or shell argument.

Terminal status and reload remain available:

```bash
systemctl status mytoken-update.path mytoken-update.service
journalctl -u mytoken-update.service
```

```bash
cd /srv/mytoken-src
git status --short --branch
git fetch --force --tags origin
git checkout --detach v0.1.0-preview.8
sudo mytokenctl deploy /srv/mytoken-src
```

`mytokenctl deploy` does not perform `git pull`, reset, checkout, or any remote operation. Git updates remain an explicit operator action.

## First access

Keep the API bound to loopback and use an SSH tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

Open `http://127.0.0.1:8080`. After initialization, use the console to connect the server-local Codex account with device-code login and issue a short-lived test key.

## Failure recovery

If installation fails before service restart, inspect the explicit error and the existing service state:

```bash
mytokenctl status
mytokenctl logs all
```

The installer never overwrites existing Secrets or operator-owned policy settings. It updates only release-derived environment values, snapshots the previous environment and runtime, and restores them together after any failed deployment. It also creates a stopped-service database backup before replacing the runtime copy. Restore a database only while `mytoken-api` is stopped, preserve ownership `mytoken-api:mytoken-api` and mode `0600`, then run `mytokenctl db-check` before starting the API.
