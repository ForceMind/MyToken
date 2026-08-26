# Model Providers

[English](PROVIDERS.md) | [简体中文](PROVIDERS.zh-CN.md)

MyToken can aggregate multiple upstream model providers behind the same MyToken Key policy and OpenAI-compatible endpoint.

## Credential boundary

- Codex models use the dedicated server-side Codex login owned by `mytoken-codex`.
- Claude models require an Anthropic API key.
- DeepSeek models require a DeepSeek API key.
- Other providers require their own API key and an OpenAI Responses-compatible endpoint.
- Provider API keys are read only by `mytoken-api` from `/etc/mytoken/provider-secrets`.
- Provider keys never enter SQLite, the browser, Codex `CODEX_HOME`, request logs, or public API responses.

A ChatGPT/Codex login cannot authorize Claude or DeepSeek. A MyToken Key is a gateway credential, not an upstream provider credential.

## Default configuration

The installer creates `/etc/mytoken/providers.json` from [the example](../deploy/providers.example.json). Missing or empty secret files leave a provider disabled without preventing Codex from starting.

```json
{
  "providers": [
    {
      "id": "anthropic",
      "name": "Claude",
      "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com",
      "apiKeyFile": "/etc/mytoken/provider-secrets/anthropic",
      "enabled": true
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "protocol": "openai-responses",
      "baseUrl": "https://api.deepseek.com",
      "apiKeyFile": "/etc/mytoken/provider-secrets/deepseek",
      "enabled": true
    }
  ]
}
```

Provider ids must be lowercase and unique. HTTPS is mandatory unless the explicit development-only `MYTOKEN_ALLOW_INSECURE_PROVIDERS=true` override is set.

## Configure keys

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
- `deepseek/<upstream-model-id>`: DeepSeek Responses provider.
- `<custom-provider-id>/<upstream-model-id>`: another configured Responses provider.

The management console dynamically groups models by provider. Key model allowlists store these canonical ids.

## Generic OpenAI Responses providers

Add another entry with `protocol: "openai-responses"`, an HTTPS `baseUrl`, and a protected `apiKeyFile`. The provider must implement compatible `/models` and `/responses` endpoints. If its model catalog endpoint is unavailable, set a fixed `models` array in the entry.

## Current compatibility

- DeepSeek: official Responses API, text, reasoning effort, usage and function-call output parsing. Raw reasoning is removed before public output.
- Claude: text Messages conversion and real token usage. Function tools and `previous_response_id` are currently rejected rather than silently downgraded.
- Codex: text plus client function-tool loop through app-server dynamic tools.
- Gateway request/Token budgets are local MyToken limits. They are not the provider's monetary balance.
- Anthropic organization cost/usage APIs require separate administrative credentials and are not queried by ordinary model API keys.

Provider availability is visible under **System → Model Providers** and never exposes secret values.
