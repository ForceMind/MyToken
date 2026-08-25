# Terminal Operations

The one-click installer places `mytokenctl` at `/usr/local/sbin/mytokenctl`. Run read-only commands as your normal SSH user. Commands that change service state or read protected files request sudo.

## Install or upgrade

Fresh server through npm:

```bash
sudo npx --yes mytoken-gateway@preview install
```

This is the intended one-command path. Node.js 22.13+ and npm are the only prerequisites that must already exist because npm itself launches the installer. Common Linux tools and the pinned compatible official Codex npm package are installed by the command.

The npm preview clones the immutable Git tag matching the package version.

From the checked-out source branch:

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
8. restarts services and waits for `/healthz`.

Set `MYTOKEN_SKIP_TESTS=true` only for emergency diagnostics, never for a normal release.

## Common commands

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl codex-status
mytokenctl permissions
```

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

```bash
cd /srv/mytoken-src
git status --short --branch
git pull --ff-only
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

The installer never overwrites existing Secrets or the environment file. It creates a stopped-service database backup before replacing the runtime copy. Restore only while `mytoken-api` is stopped, preserve ownership `mytoken-api:mytoken-api` and mode `0600`, then run `mytokenctl db-check` before starting the API.
