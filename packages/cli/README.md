# mytoken-gateway

Installer and operations bootstrap for [MyToken Gateway](https://github.com/ForceMind/MyToken), a self-hosted Personal Codex Gateway.

> Preview software. MyToken is independent and is not affiliated with, endorsed by, or operated by OpenAI.

## Requirements

- Linux server with systemd
- Node.js 22.13 or newer and npm
- sudo/root access

The CLI installs missing common operating-system tools through `dnf` or `apt-get`, clones the MyToken source, installs the pinned compatible official Codex CLI package, runs all checks, and installs the systemd services.

Each published CLI version defaults to an immutable matching Git tag, not a moving branch.

## Install

```bash
sudo npx --yes mytoken-gateway@preview install
```

Then access the loopback service through SSH:

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

Open `http://127.0.0.1:8080` and retrieve the one-time Bootstrap Token:

```bash
sudo mytokenctl bootstrap-token
```

## Operations

```bash
mytoken-gateway status
mytoken-gateway doctor
mytoken-gateway codex-status
sudo mytoken-gateway backup
```

The installed `/usr/local/sbin/mytokenctl` provides the full operations command set.

## Update

Updates fail closed when the source checkout has local changes:

```bash
sudo npx --yes mytoken-gateway@preview update
```

## Continue development on the server

```bash
mytoken-gateway handoff
cd /srv/mytoken-src
git switch -c codex/feat-mytoken-v0-1 --track origin/codex/feat-mytoken-v0-1
codex
```

## Security

- Existing Secrets and configuration are never overwritten.
- The database is backed up before a runtime update.
- MyToken never reads or packages Codex `auth.json`.
- The npm package contains only this bootstrap CLI, README, and Apache-2.0 license.
- The application source is cloned from the configured GitHub repository/ref and verified by the repository's tests and pinned Codex contract before installation.
