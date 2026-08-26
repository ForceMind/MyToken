# Project State

## Current state

- Phase: Gate 2 remediation — policy, observability, client correctness, and live operations
- Repository implementation at start: none (license only)
- Development platform: macOS
- Target production platform: Linux with systemd
- Verified local Codex CLI: `0.147.0`
- OpenClaw support: schema and deterministic fixture verified; live verification pending

## Verified facts

- The installed CLI exposes stable and experimental schema generators.
- The experimental schema contains `thread/start.dynamicTools`.
- The protocol contains the server request `item/tool/call` and its response type.
- Authentication, account state, model listing, rate limits, threads, turns, interruption, and deletion are present in the generated protocol surface.
- A bounded JSONL JSON-RPC client completes initialize, normal request, notification, and server-request flows.
- The deterministic fixture completes `function_call -> function_call_output -> final answer` on the same simulated turn.
- HMAC MyToken keys, model policy, client-tool policy, Responses validation, and SSE function-call encoding have automated tests.
- The worker exposes a fixed internal route allowlist; arbitrary JSON-RPC passthrough is absent and tested.
- Thirty-six automated tests pass, including Key IP/CIDR, request balance/concurrency policy, request logging, a two-request function-tool loop, deployment-script syntax checks, and the published CLI help contract.
- SQLite/Drizzle schema, idempotent runtime migration, integrity check, persistent API keys, and immediate revocation are implemented.
- One-time Bootstrap, Argon2id administrator passwords, digest-only server sessions, CSRF, and admin key issuance are implemented.
- API and worker have separate production entrypoints and communicate through a bounded Unix-socket client.
- systemd, tmpfiles, systemd credential injection, secret generation, and deployment guidance are present but not live-verified.
- React/Vite/Tailwind management console implements setup, login, overview, Codex status/device login, Key management, and system status.
- A text-only `/v1/chat/completions` adapter supports ordinary AI chat clients; structured tools remain on the canonical Responses path.
- An idempotent one-click Linux installer preserves existing Secrets/config, backs up an existing database, rebuilds, installs, restarts, and health-checks the service.
- `mytokenctl` provides service, log, health, Codex status, permission, database, backup, bootstrap, version, and redeploy operations.
- The `mytoken-gateway@0.1.0-preview.1` npm bootstrap package packs to four audited files and installs/runs successfully from its tarball.
- Source is prepared for `0.1.0-preview.3`; registry publication and the matching Git tag are still required before page-based updates can install it.
- Per-Key model allowlists, IP/CIDR allowlists, RPM, daily limits, concurrency, request balance, token budget, usage summaries, source IP, request context, response context, and request-log administration are implemented.
- Codex account detection now precedes login, logout requires confirmation in the console, and ChatGPT rate-limit plus account-usage data are normalized for display.
- Gateway Codex threads are ephemeral so gateway calls do not enter the normal Codex conversation list.
- The API can route canonical `provider/model` ids to Anthropic Messages, DeepSeek Responses, and additional configured OpenAI Responses-compatible providers. Provider keys remain in API-only secret files.
- The built console was exercised through the real Fastify static server in the in-app browser with no browser console errors; automated Playwright coverage remains pending.

## Not yet verified

- Live ChatGPT device-code login through this implementation.
- Live dynamic-tool invocation and delayed result continuation.
- Live streaming timing against a real authenticated Codex account and reverse proxy.
- Linux/systemd hardening.
- Real OpenClaw E2E.
- Automated Playwright browser E2E.
- Durable response and pending-tool-call recovery across API restarts.
- Runtime proof that no Codex-native command starts before the defensive interrupt arrives.

## Completion rule

Schema presence is `schema-verified`. Only a real successful call is `runtime-verified`.
