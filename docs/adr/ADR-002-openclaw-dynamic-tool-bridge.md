# ADR-002: OpenClaw dynamic tool bridge

- Status: Accepted with runtime gate

## Context

OpenClaw requires structured function calling. A text-only adapter is not OpenClaw Agent support. Codex app-server exposes client-provided tools through experimental `dynamicTools` and `item/tool/call`.

## Decision

Translate OpenAI function tools into app-server dynamic tools. Return tool calls to OpenClaw and wait for `function_call_output`; never execute the tool in MyToken.

## Alternatives

- Block tools: rejected because it does not meet the OpenClaw requirement.
- Execute OpenClaw tools on the server: rejected because it grants API callers server execution.
- Parse tool-looking text: rejected because it is ambiguous and unsafe.

## Security consequences

Pending tool calls become security-critical state and require strict ownership, expiry, idempotency, bounds, cancellation, and generation checks.

## Operational consequences

The worker must keep an app-server connection and pending server request alive across public HTTP requests. Restart invalidates pending calls.

## Rollback

Disable client tools and advertise `supportsTools: false`. Text responses can remain available, but the product must report OpenClaw Agent support as unavailable.
