# Threat Model

## Protected assets

- Codex-managed ChatGPT credentials and account access.
- MyToken keys, administrator session secrets, and key pepper.
- Prompt and response content in transit.
- OpenClaw tool definitions, arguments, results, and call ownership.
- Server filesystem, command execution, network access, and process identity.

## Trust zones

1. Public clients authenticated by a MyToken key.
2. Administrator browser authenticated by a server-side session and CSRF token.
3. API process with policy and database access.
4. Worker process with Codex access.
5. Codex app-server subprocess and its dedicated empty workspace.

## Principal threats and controls

### Credential extraction

MyToken never reads or parses `auth.json`. The API process cannot access the Codex home. Logs use an allowlist and redact authorization, cookies, tokens, codes, and paths.

### Arbitrary server execution

Public tool definitions are translated only into app-server dynamic tools. The worker never executes their commands. Codex-native command, file, MCP, app, plugin, web, process, or permission events interrupt the turn.

### Tool-result confusion

Every pending call is bound to API key, public response, app-server generation, thread, turn, JSON-RPC request id, and tool call id. A result with any mismatched component is rejected. Results are one-shot and expire.

### Replay and duplicate execution

Tool outputs are idempotent by `(responseId, callId)`. Duplicate identical output returns the recorded disposition; conflicting output fails closed. A worker generation change invalidates all pending calls.

### Resource exhaustion

Requests, tool counts, schema size/depth, argument size, result size, stream buffers, pending calls, concurrency, queue length, and duration are bounded.

### Public exposure

The API binds to loopback by default. Public exposure is explicit, requires TLS, allowed hosts, trusted proxy configuration, per-key limits, and an administrator warning.

## Residual risk

`codex app-server` and `dynamicTools` are experimental. Version pinning and fail-closed probes reduce but do not remove protocol-change risk. This product must not be represented as a stable OpenAI API replacement.
