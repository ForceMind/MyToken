# API Compatibility

MyToken implements a documented subset of OpenAI-compatible APIs. It is not a drop-in replacement for every OpenAI API feature.

| Surface                       | V0.1 target               | Notes                                               |
| ----------------------------- | ------------------------- | --------------------------------------------------- |
| `GET /v1/models`              | Supported                 | Dynamic server Codex catalog filtered by key policy |
| `POST /v1/responses` text     | Supported                 | Canonical API                                       |
| Responses SSE                 | Supported                 | Live Codex deltas; bounded external fallback        |
| Function tools                | Supported                 | Client-defined tools executed by the client         |
| Tool choice                   | Supported subset          | Function tools only                                 |
| Parallel tool calls           | Supported after gate      | Bounded and ownership checked                       |
| Previous response             | Process-local preview     | Bound to the creating key; restart invalidates it   |
| Store                         | Gateway log only          | Codex threads are always ephemeral                  |
| Reasoning effort              | Supported when advertised | Validated against model metadata                    |
| Structured output             | Planned                   | Only after schema contract tests                    |
| Images/audio/files            | Rejected in V0.1          | No silent downgrade                                 |
| Built-in web/file/shell tools | Rejected                  | Never exposed through the public API                |
| `/v1/chat/completions`        | Supported text subset     | Text messages and SSE; tools are rejected           |
