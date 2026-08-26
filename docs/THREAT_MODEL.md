# Threat Model

[English](THREAT_MODEL.md) | [简体中文](THREAT_MODEL.zh-CN.md)

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

Public function definitions are translated only into app-server dynamic tools and are returned to the calling client for execution. Codex-native command, file, MCP, app, plugin, web, process, or permission events trigger an immediate defensive interrupt. Because app-server reports an item as it starts, this is detection and interruption rather than a proven execution-prevention boundary; public deployment remains blocked until a live adversarial test or stronger execution isolation closes that gap.

### Tool-result confusion

Every in-memory pending call is bound to API key, public response, app-server generation, thread, turn, JSON-RPC request id, and tool call id. A result with a mismatched owner, turn, or generation is rejected. Results are one-shot and expire, but restart recovery is not yet implemented.

### Replay and duplicate execution

Duplicate call ids and duplicate outputs in one continuation fail closed. Durable replay dispositions across HTTP retries or worker restarts are not yet implemented. A worker generation change invalidates in-memory pending calls.

### Resource exhaustion

Requests, tool counts, schema size/depth, argument size, result size, stream buffers, pending calls, concurrency, queue length, and duration are bounded.

### Public exposure

The API binds to loopback by default. Public exposure is explicit, requires TLS, allowed hosts, trusted proxy configuration, per-key limits, and an administrator warning.

## Residual risk

`codex app-server` and `dynamicTools` are experimental. Version pinning and fail-closed probes reduce but do not remove protocol-change risk. This product must not be represented as a stable OpenAI API replacement.
