# Model Providers

[English](PROVIDERS.md) | [简体中文](PROVIDERS.zh-CN.md)

MyToken can aggregate multiple upstream model providers behind the same MyToken Key policy and OpenAI-compatible endpoint.

## Credential boundary

- Codex models use the dedicated server-side Codex login owned by `mytoken-codex`.
- Claude models require an Anthropic API key.
- DeepSeek models require a DeepSeek API key.
- Other providers require their own API key and a compatible Anthropic Messages, OpenAI Chat Completions, or OpenAI Responses endpoint.
- Provider API keys are read only by `mytoken-api` from `/var/lib/mytoken/api/provider-secrets`.
- Provider keys never enter SQLite, the browser, Codex `CODEX_HOME`, request logs, or public API responses.

A ChatGPT/Codex login cannot authorize Claude or DeepSeek. A MyToken Key is a gateway credential, not an upstream provider credential.

## Default configuration

The installer creates `/var/lib/mytoken/api/providers.json` from [the example](../deploy/providers.example.json). Missing or empty secret files leave a provider unconfigured without preventing Codex from starting. Existing legacy config and keys are migrated from `/etc/mytoken` during upgrade.

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Claude",
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyFile": "/var/lib/mytoken/api/provider-secrets/anthropic",
      "enabled": true
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "protocol": "openai-chat",
      "baseUrl": "https://api.deepseek.com",
      "apiKeyFile": "/var/lib/mytoken/api/provider-secrets/deepseek",
      "enabled": true
    }
  ]
}
```

Provider ids must be lowercase and unique. HTTPS is mandatory unless the explicit development-only `MYTOKEN_ALLOW_INSECURE_PROVIDERS=true` override is set.

## Configure providers in the console

Open **System → Model Providers**:

1. choose Claude or DeepSeek, or click **Add compatible provider**;
2. select the upstream protocol and HTTPS Base URL;
3. optionally set a fixed comma-separated model list when `/models` is unavailable;
4. enter the upstream API Key and save.

The API Key is sent only to the same-origin management API over your protected connection, written as a `0600` file, and never returned in later responses. Saving reloads provider routing immediately without restarting Codex.

## Configure keys in the terminal

Enter a key without putting it on the command line or in shell history:

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

Alternatively, copy an existing protected file:

```bash
sudo mytokenctl provider-set anthropic /secure/path/anthropic-key
```

The command installs the key as `0600 mytoken-api:mytoken-api` and restarts only the API service.

## Model ids

- Existing bare model id, such as `gpt-5.6-terra`: Codex provider.
- `anthropic/<upstream-model-id>`: Anthropic Messages provider.
- `deepseek/<upstream-model-id>`: DeepSeek Chat Completions provider.
- `<custom-provider-id>/<upstream-model-id>`: another configured provider.

The management console dynamically groups models by provider. Key model allowlists store these canonical ids.

## Generic providers

The console supports these protocols:

- `anthropic`: `/v1/models` and `/v1/messages`;
- `openai-chat`: `/models` and `/chat/completions`;
- `openai-responses`: `/models` and `/responses`.

If the upstream model catalog is unavailable, set a fixed model list in the form.

## Current compatibility

- DeepSeek: official Chat Completions API, text and token usage. Tools and `previous_response_id` are rejected rather than silently ignored.
- Claude: text Messages conversion and real token usage. Function tools and `previous_response_id` are currently rejected rather than silently downgraded.
- Codex: text plus client function-tool loop through app-server dynamic tools.
- Gateway request/Token budgets are local MyToken limits. They are not the provider's monetary balance.
- Anthropic organization cost/usage APIs require separate administrative credentials and are not queried by ordinary model API keys.

Provider availability is visible under **System → Model Providers** and never exposes secret values.
