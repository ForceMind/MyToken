# ADR-001: Server-local Codex boundary

- Status: Accepted

## Context

MyToken is installed on a trusted server. The administrator signs Codex into a dedicated server-local home. Browser clients do not supply or receive Codex credentials.

## Decision

Run API and Codex adapter as separate processes connected through a fixed Unix-socket API. Only the adapter can spawn app-server or access its home.

## Alternatives

- One process: rejected because an API compromise would directly expose Codex credentials.
- Browser-local connector: rejected because it is not the requested deployment model.

## Consequences

Linux deployment needs two users, exact directory ownership, and socket lifecycle management. Development can use fixtures without weakening the production boundary.

## Rollback

Disable the worker service and revoke MyToken keys. Codex credentials remain owned by Codex and can be cleared with `codex logout` in the dedicated home.
