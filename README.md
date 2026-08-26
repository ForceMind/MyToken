# MyToken Gateway

[English](README.md) | [简体中文](README.zh-CN.md)

MyToken Gateway is a private, single-administrator AI model gateway for a trusted Linux server. It can use a server-local Codex/ChatGPT login and optional Anthropic, DeepSeek, OpenAI Chat Completions, or OpenAI Responses-compatible providers, then issue restricted MyToken API keys to your own clients.

> MyToken is independent and is not affiliated with, endorsed by, or operated by OpenAI, Anthropic, or DeepSeek.

## What it provides

- OpenAI-compatible `GET /v1/models`, `POST /v1/responses`, and text `POST /v1/chat/completions`;
- live Responses and Chat Completions SSE for Codex;
- Codex client function-tool continuation for Responses clients such as OpenClaw;
- dynamic Codex, Claude, DeepSeek, and custom provider model catalogs;
- per-key model, IP/CIDR, RPM, daily request, concurrency, request-balance, and token-budget controls;
- request, IP, model, latency, token, context, response, and error logs;
- a management console for Codex login, quotas, keys, providers, test chat, logs, and system status;
- a light-by-default interface with a persistent dark-mode toggle;
- protected browser-triggered updates through a constrained systemd updater;
- ephemeral Codex gateway threads that do not appear in the normal Codex conversation list.

## Requirements

- Linux server using systemd;
- Node.js 22.13 or newer and npm;
- root or sudo access;
- a trusted private deployment.

The installer supports OpenCloudOS/RHEL/Fedora and Debian/Ubuntu package tooling. The API binds to `127.0.0.1:8080` by default.

## Install from GitHub — current development channel

Release tag, recommended for repeatable installation:

```bash
sudo git clone --branch v0.1.0-preview.9 --depth 1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

Latest `main`, intended for development/testing:

```bash
sudo git clone --branch main \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

Do not install from an unreviewed fork or branch as root.

## First access

The service stays on loopback. From your workstation:

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

On the server, read the one-time setup token:

```bash
sudo mytokenctl bootstrap-token
```

Then open `http://127.0.0.1:8080`, create the administrator, and check **Codex connection**. MyToken detects the dedicated server Codex login before offering a login flow.

Terminal login is also available:

```bash
sudo mytokenctl codex-status
sudo mytokenctl codex-login
sudo mytokenctl codex-import root
```

The console can also import a file-based login from a selected Linux user's default `~/.codex`. The guarded root helper copies only `auth.json` into the isolated service home, validates ownership/path/size and `codex login status`, and never returns credential contents to the API or browser. Keyring-backed logins still require device login.

## Add Claude, DeepSeek, or another provider

Each external provider requires its own upstream API key; a Codex login cannot authorize Claude or DeepSeek.

Open **System → Model Providers**, choose Claude or DeepSeek, and enter its upstream API Key. Use **Add compatible provider** for another Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses endpoint. Keys are written to protected server files and never returned to the browser.

Terminal configuration remains available through `mytokenctl provider-set`.

Model ids are exposed as bare ids for Codex, `anthropic/<model-id>` for Claude, `deepseek/<model-id>` for DeepSeek, and `<provider>/<model-id>` for configured compatible providers. See [Model Providers](docs/PROVIDERS.md).

## Update

After preview.8 is installed, **System → System update** discovers and installs the latest GitHub release tag without npm. To install the current preview over an older release for the first time, run:

```bash
cd /srv/mytoken-src
sudo git fetch --force --tags origin
sudo git checkout --detach v0.1.0-preview.9
sudo env MYTOKEN_SOURCE_DIR=/srv/mytoken-src ./deploy/install.sh
```

Updates are single-flight, back up and integrity-check SQLite, verify exact release metadata, and treat the runtime plus release-derived environment values as one rollback unit. Completion requires matching source, deployed-package, configured-environment, API, and UI versions.

## Operations

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl version-check
mytokenctl logs all
sudo mytokenctl backup
```

See [Terminal Operations](docs/OPERATIONS.md) and [Installation](docs/INSTALLATION.md).

## Development

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:security
npm run build
npm run db:check
npm run codex:check-contract
```

## Project status and security

This is personal/private preview software, not a public commercial API service. Codex app-server and the dynamic tool bridge include experimental protocol surface. Native Codex execution items are defensively interrupted, but this is not yet a proven execution-prevention boundary. Keep MyToken private, require TLS and an additional identity layer before remote exposure, and issue keys only to devices you control.

- [Documentation index](docs/README.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [API compatibility](docs/API_COMPATIBILITY.md)
- [Deployment](docs/DEPLOYMENT.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
