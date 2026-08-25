# Project State

## Current state

- Phase: Gate 3 — clients, UI, and live operations
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
- Twenty-eight automated tests pass, including a two-request OpenClaw tool loop through the worker's internal HTTP contract.
- SQLite/Drizzle schema, idempotent runtime migration, integrity check, persistent API keys, and immediate revocation are implemented.
- One-time Bootstrap, Argon2id administrator passwords, digest-only server sessions, CSRF, and admin key issuance are implemented.
- API and worker have separate production entrypoints and communicate through a bounded Unix-socket client.
- systemd, tmpfiles, systemd credential injection, secret generation, and deployment guidance are present but not live-verified.
- React/Vite/Tailwind management console implements setup, login, overview, Codex status/device login, Key management, and system status.
- A text-only `/v1/chat/completions` adapter supports ordinary AI chat clients; structured tools remain on the canonical Responses path.
- The built console was exercised through the real Fastify static server in the in-app browser with no browser console errors; automated Playwright coverage remains pending.

## Not yet verified

- Live ChatGPT device-code login through this implementation.
- Live dynamic-tool invocation and delayed result continuation.
- Production streaming from live app-server rather than buffered fixture output.
- Linux/systemd hardening.
- Real OpenClaw E2E.
- Automated Playwright browser E2E.
- Durable response and pending-tool-call recovery across API restarts.

## Completion rule

Schema presence is `schema-verified`. Only a real successful call is `runtime-verified`.
