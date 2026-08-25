# API Compatibility

MyToken implements a documented subset of OpenAI-compatible APIs. It is not a drop-in replacement for every OpenAI API feature.

| Surface                       | V0.1 target               | Notes                                               |
| ----------------------------- | ------------------------- | --------------------------------------------------- |
| `GET /v1/models`              | Supported                 | Dynamic server Codex catalog filtered by key policy |
| `POST /v1/responses` text     | Supported                 | Canonical API                                       |
| Responses SSE                 | Supported                 | Bounded streaming and cancellation                  |
| Function tools                | Supported                 | Client-defined tools executed by the client         |
| Tool choice                   | Supported subset          | Function tools only                                 |
| Parallel tool calls           | Supported after gate      | Bounded and ownership checked                       |
| Previous response             | Supported                 | Bound to the creating key                           |
| Store                         | Supported subset          | Default false; retention is explicit                |
| Reasoning effort              | Supported when advertised | Validated against model metadata                    |
| Structured output             | Planned                   | Only after schema contract tests                    |
| Images/audio/files            | Rejected in V0.1          | No silent downgrade                                 |
| Built-in web/file/shell tools | Rejected                  | Never exposed through the public API                |
| `/v1/chat/completions`        | Planned adapter           | Secondary compatibility surface                     |
