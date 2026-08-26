# Architecture

```text
Admin Browser / OpenClaw / AI Client
                  |
                  | HTTPS + admin session or MyToken key
                  v
             mytoken-api
     keys / policy / audit / SQLite
                  |
                  | fixed HTTP API over Unix socket
                  v
            mytoken-worker
       protocol adapter / tool broker
                  |
                  | JSONL JSON-RPC over stdio
                  v
          codex app-server
                  |
                  v
       Codex-managed ChatGPT account
```

`mytoken-api` also owns optional external model providers. Anthropic, DeepSeek, and generic OpenAI Responses credentials stay in API-only secret files and never cross into `mytoken-worker`:

```text
                        +--> mytoken-worker --> codex app-server
public Responses --> API router
                        +--> Anthropic Messages API
                        +--> DeepSeek / other Responses API
```

External model ids are canonical `provider/model` strings. Existing bare model ids remain a Codex compatibility alias.

## Dependency direction

- Shared packages contain data-only contracts and pure utilities.
- API code depends on public and internal contracts, never on app-server protocol details.
- Worker code depends on the pinned generated Codex contracts and translates them into the internal contract.
- Worker routes are a fixed allowlist. No endpoint accepts an arbitrary app-server method.

## Credential boundary

- `mytoken-api` cannot read the Codex home.
- `mytoken-worker` cannot read the API database, administrator password hashes, session secret, or MyToken key pepper.
- Codex access and refresh tokens never cross the worker boundary.
- Account information returned to the API is normalized and minimized.

## Tool boundary

`dynamicToolCall` means the remote OpenClaw client must execute a declared client function. It is allowed only when the authenticated MyToken key has `allowClientTools` and the call belongs to that key's active response.

All Codex-native execution items are forbidden in gateway turns. Receiving one interrupts the turn and records a redacted security event.
