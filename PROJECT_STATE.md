# Project State

## Current state

- Phase: Gate 2 — Responses API foundation
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

## Not yet verified

- Live ChatGPT device-code login through this implementation.
- Live dynamic-tool invocation and delayed result continuation.
- Persistent SQLite stores, administrator authentication, and Unix-socket process split.
- Production streaming from live app-server rather than buffered fixture output.
- Linux/systemd hardening.
- Real OpenClaw E2E.

## Completion rule

Schema presence is `schema-verified`. Only a real successful call is `runtime-verified`.
