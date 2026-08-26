# Installation

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

## Supported target

Use a Linux server with systemd, Node.js 22.13 or newer, npm, and root/sudo access. MyToken does not install its services on macOS or Windows.

## Option A: npm bootstrap — recommended

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview install
```

The bootstrap package:

1. resolves the exact npm preview version;
2. checks out the matching Git tag under `/srv/mytoken-src`;
3. verifies npm integrity, published `gitHead`, source origin, and commit;
4. installs the pinned compatible Codex CLI when needed;
5. runs formatting, type, lint, test, database, contract, and build checks;
6. installs and starts the systemd services.

If your server uses a delayed npm mirror, keep the explicit `npm_config_registry` setting shown above.

## Option B: GitHub source

Pinned release:

```bash
sudo git clone --branch v0.1.0-preview.7 --depth 1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

Latest main branch for development:

```bash
sudo git clone --branch main \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

The GitHub path runs the same tests, backup, staging, systemd, health-check, and rollback logic as the npm bootstrap.

## First access

Forward the loopback management service from your workstation:

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

Read the one-time token on the server:

```bash
sudo mytokenctl bootstrap-token
```

Open `http://127.0.0.1:8080`, initialize the administrator, then verify the Codex and provider status.

## Configure models

Codex login:

```bash
sudo mytokenctl codex-status
sudo mytokenctl codex-login
```

Optional external providers:

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

## Update

Use **System → System update** in the console or:

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview update
```

The updater refuses dirty source checkouts, validates the fetched target release, creates a consistent SQLite backup, and rolls back both runtime and release-derived environment values after any deployment failure. It reports success only when the source, deployed package, configured environment, `/versionz`, `/version.json`, and served UI entry agree.

## Verify

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl version-check
```

The service is private by default. Keep it on loopback or add TLS and an additional identity layer before any remote exposure.
