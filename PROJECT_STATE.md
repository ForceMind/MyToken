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
- Sixty-four automated tests pass, including Key IP/CIDR, request balance/concurrency policy, request logging, a two-request function-tool loop, Provider and Codex credential import coordination, GitHub update selection, deployment-script syntax/release checks, and the CLI help contract.
- SQLite/Drizzle schema, idempotent runtime migration, integrity check, persistent API keys, and immediate revocation are implemented.
- One-time Bootstrap, Argon2id administrator passwords, digest-only server sessions, CSRF, and admin key issuance are implemented.
- API and worker have separate production entrypoints and communicate through a bounded Unix-socket client.
- systemd, tmpfiles, systemd credential injection, secret generation, and deployment guidance are present but not live-verified.
- React/Vite/Tailwind management console implements setup, login, overview, Codex status/device login, Key management, and system status.
- A text-only `/v1/chat/completions` adapter supports ordinary AI chat clients; structured tools remain on the canonical Responses path.
- An idempotent one-click Linux installer preserves existing Secrets/config, backs up an existing database, rebuilds, installs, restarts, and health-checks the service.
- `mytokenctl` provides service, log, health, Codex status, permission, database, backup, bootstrap, version, and redeploy operations.
- The `mytoken-gateway@0.1.0-preview.1` npm bootstrap package packs to four audited files and installs/runs successfully from its tarball.
- npm development publication is paused after `0.1.0-preview.7`. Source is prepared as GitHub-only `0.1.0-preview.9`; once its matching Git tag is pushed, page-based updates use GitHub directly.
- Per-Key model allowlists, IP/CIDR allowlists, RPM, daily limits, concurrency, request balance, token budget, usage summaries, source IP, request context, response context, and request-log administration are implemented.
- Codex account detection now precedes login, logout requires confirmation in the console, and ChatGPT rate-limit plus account-usage data are normalized for display.
- Gateway Codex threads are ephemeral so gateway calls do not enter the normal Codex conversation list.
- The API routes canonical `provider/model` ids to Anthropic Messages, DeepSeek Chat Completions, and configurable OpenAI Chat/Responses providers. The console can manage provider definitions and write-only API keys without returning secret values.
- The management console defaults to a light theme and persists an explicit dark-mode preference locally.
- The built console was exercised through the real Fastify static server in the in-app browser with no browser console errors; automated Playwright coverage remains pending.
- A preview.6 deployment exposed a split-brain rollback defect: the runtime returned to preview.1 while release-derived environment values remained preview.6. Preview.7 makes runtime/environment rollback transactional and verifies matching source, deployed-package, configured-environment, API, and UI release markers before reporting success.
- Preview.8 makes Codex Provider readiness authentication-aware, moves managed provider state into the API-owned protected directory, and changes privileged page updates from npm to immutable GitHub tags.
- Preview.9 adds explicit import of a selected Linux user's default file-backed Codex login through a guarded root systemd helper while preserving the isolated service `CODEX_HOME`.
- The preview console Provider cards and Claude configuration form were exercised through the real Fastify static server with no browser console warnings or errors.

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
