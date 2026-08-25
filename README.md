# MyToken Gateway

Personal Codex Gateway — a private, single-administrator gateway that runs Codex on a trusted server and issues local MyToken credentials to approved clients.

> MyToken is an independent personal gateway and is not affiliated with, endorsed by, or operated by OpenAI.
>
> MyToken 是独立的个人私有网关，与 OpenAI 不存在隶属、授权或官方合作关系。

## Status

V0.1 is under active development and is not production-ready.

Implemented and verified offline:

- pinned Codex `0.147.0` stable and experimental protocol artifacts;
- bounded JSONL JSON-RPC app-server client;
- fixed worker-internal route allowlist;
- HMAC MyToken key creation, parsing, expiry, and revocation;
- `/v1/models` and `/v1/responses` contract foundation;
- OpenClaw function-tool bridge with deterministic two-request fixture coverage;
- OpenAI Responses SSE text and function-call event encoding.
- SQLite/Drizzle schema, migrations, integrity checks, and persistent key records.
- one-time administrator Bootstrap, Argon2id login, server-side Session, and CSRF;
- separate API/worker startup entrypoints with Unix-socket transport;
- Linux systemd, tmpfiles, credential, and secret-generation templates.

Not yet complete:

- management console;
- live Codex login and live dynamic-tool smoke tests;
- Linux/systemd verification;
- real OpenClaw E2E.

## Security boundary

Codex credentials remain under a dedicated server-side `CODEX_HOME` and are managed by Codex. MyToken must never parse or export `auth.json`.

OpenClaw client tools are represented as app-server dynamic tools, but they are executed by OpenClaw, not by the MyToken server. Codex-native shell, file, MCP, plugin, app, web-search, process, and permission capabilities remain blocked for gateway turns.

See [Architecture](docs/ARCHITECTURE.md), [Threat Model](docs/THREAT_MODEL.md), and [API Compatibility](docs/API_COMPATIBILITY.md).

## Development

Requirements:

- Node.js 22 or newer
- npm
- Codex CLI `0.147.0` for the currently pinned contract

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run codex:check-contract
npm run doctor
```

Regenerate contracts only for a deliberately qualified new Codex version:

```bash
npm run codex:generate-schema
```

The generator refuses to overwrite an existing version directory.

## Planned OpenClaw configuration

The management console will generate this configuration from the live model catalog. It is not usable until the production server entrypoints and live tool probe are complete.

```json5
{
  models: {
    providers: {
      mytoken: {
        baseUrl: "https://mytoken.example.com/v1",
        apiKey: "${MYTOKEN_API_KEY}",
        api: "openai-responses",
        models: [
          {
            id: "<model-id>",
            name: "<model-name>",
            reasoning: true,
            input: ["text"],
            compat: {
              supportsTools: true,
              supportsStrictMode: false,
              supportsStore: false,
              supportsReasoningEffort: true,
              supportsTemperature: false,
              supportsUsageInStreaming: false,
            },
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "mytoken/<model-id>" },
    },
  },
}
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
