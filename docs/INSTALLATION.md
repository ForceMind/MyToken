# Installation

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

## Supported target

Use a Linux server with systemd, Node.js 22.13 or newer, npm, and root/sudo access. MyToken does not install its services on macOS or Windows.

## GitHub source — current channel

Pinned release:

```bash
sudo git clone --branch v0.1.0-preview.9 --depth 1 \
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

The installer runs formatting, type, lint, tests, database, Codex contract, build, backup, staging, systemd, release consistency, health-check, and rollback gates.

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
sudo mytokenctl codex-import root
```

Use **Codex connection → Import existing Linux login** or `codex-import USER` only for file-backed credentials in that user's default `~/.codex`. Keyring-backed or custom `CODEX_HOME` logins use the dedicated device flow instead.

External providers can be configured directly under **System → Model Providers**. The page supports Claude, DeepSeek, and custom Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses endpoints. Terminal configuration remains available:

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

## Update

After preview.8 is installed, use **System → System update**. The privileged updater fetches and verifies immutable tags directly from `ForceMind/MyToken` on GitHub; it does not query or execute npm. For the one-time upgrade from an older npm-based release:

```bash
cd /srv/mytoken-src
sudo git fetch --force --tags origin
sudo git checkout --detach v0.1.0-preview.9
sudo env MYTOKEN_SOURCE_DIR=/srv/mytoken-src ./deploy/install.sh
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
