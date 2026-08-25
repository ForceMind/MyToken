# MyToken Gateway V0.1 Master Plan

## Objective

Build a single-administrator, single-account, self-hosted gateway that runs Codex CLI on the server, lets the administrator complete Codex-managed ChatGPT authentication, and issues private MyToken keys for OpenAI Responses-compatible clients.

OpenClaw is a required V0.1 client. Support means a complete client-tool loop, not text-only chat.

## Product boundary

- Codex CLI and `codex app-server` run on the MyToken server.
- Codex owns OAuth credentials and refresh. MyToken never parses `auth.json`.
- `mytoken-api` owns administrator sessions, MyToken keys, policy, audit data, and public HTTP endpoints.
- `mytoken-worker` is the only service allowed to run Codex and access its dedicated `CODEX_HOME`.
- MyToken keys authenticate calls to this gateway only. They are not OpenAI API keys.
- V0.1 is personal/private preview software. It is not a public multi-user API service.

## OpenClaw contract

The canonical OpenClaw path is:

```text
OpenClaw --OpenAI Responses--> mytoken-api --fixed IPC--> mytoken-worker
  --JSON-RPC--> codex app-server
```

Client-defined function tools are allowed only through the following bridge:

1. OpenClaw sends `tools` to `/v1/responses`.
2. MyToken validates and translates them to app-server `dynamicTools`.
3. app-server emits `item/tool/call`.
4. MyToken returns an OpenAI `function_call` item to OpenClaw without executing it.
5. OpenClaw executes the tool in its own environment.
6. OpenClaw sends `function_call_output`.
7. MyToken resolves the pending app-server server request and continues the same turn.

Server-side Codex shell, file changes, MCP, plugins, apps, web search, permission requests, and background processes remain forbidden and fail closed.

## Experimental API exception

The app-server command and dynamic tool bridge are experimental in the current Codex release. V0.1 therefore:

- pins an exact Codex CLI version and generated schema hash;
- enables `experimentalApi` only in the worker connection that needs `dynamicTools`;
- exposes no arbitrary JSON-RPC passthrough;
- runs a capability probe before advertising OpenClaw tool support;
- fails closed on an unknown version, schema, method, field, or event;
- never silently downgrades a tool request to text.

## Delivery gates

### Gate 0 — protocol qualification

- Generate stable and experimental JSON/TypeScript schemas.
- Implement bounded JSONL JSON-RPC transport.
- Verify initialize/initialized ordering.
- Verify `dynamicTools` exists in the pinned schema.
- Verify `item/tool/call` request/response correlation with a deterministic fixture.
- Provide an opt-in live probe using a harmless synthetic tool.

### Gate 1 — security foundation

- Secret loader, redacted logging, configuration validation.
- HMAC-based MyToken key creation and verification.
- Administrator bootstrap/session/CSRF.
- SQLite migrations and ownership records.

### Gate 2 — Responses API

- `/v1/models` from `model/list`.
- `/v1/responses` text, streaming, cancellation, reasoning effort.
- Function tools, tool choice, tool outputs, pending-call ownership.
- Store/previous-response behavior and cleanup.

### Gate 3 — clients and operations

- Real OpenClaw custom-provider E2E.
- Optional `/v1/chat/completions` adapter for broader chat clients.
- Management console, systemd, backup, doctor, and Linux verification.

## Definition of OpenClaw support

V0.1 is not complete until a real OpenClaw instance can:

- authenticate with a MyToken key;
- list and select a model;
- complete a normal text turn;
- complete `function_call -> function_call_output -> final answer`;
- stream text and function-call arguments;
- cancel a turn;
- fail safely across key revocation, timeout, worker restart, and duplicate tool output;
- prove that the MyToken server did not execute the OpenClaw tool.
