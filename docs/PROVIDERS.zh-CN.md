# 模型 Provider

[English](PROVIDERS.md) | [简体中文](PROVIDERS.zh-CN.md)

MyToken 可以在同一套 MyToken Key 策略和 OpenAI-compatible 地址后聚合多个上游模型服务。

## 凭据边界

- Codex 模型使用 `mytoken-codex` 专用服务用户的服务器 Codex 登录。
- Claude 需要 Anthropic API Key。
- DeepSeek 需要 DeepSeek API Key。
- 其他 Provider 需要自己的 API Key 和兼容 OpenAI Responses 的接口。
- Provider Key 只由 `mytoken-api` 从 `/etc/mytoken/provider-secrets` 读取。
- Provider Key 不进入 SQLite、浏览器、Codex `CODEX_HOME`、请求日志或公共响应。

ChatGPT/Codex 登录不能授权 Claude 或 DeepSeek；MyToken Key 也不是任何上游 Provider Key。

## 配置 Key

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

也可以从受保护文件导入：

```bash
sudo mytokenctl provider-set anthropic /secure/path/anthropic-key
```

Key 会以 `0600 mytoken-api:mytoken-api` 保存，只重启 API 服务。

## 模型 ID

- `gpt-...` 等裸模型 ID：Codex 兼容模式；
- `anthropic/<upstream-model-id>`：Claude；
- `deepseek/<upstream-model-id>`：DeepSeek；
- `<provider>/<upstream-model-id>`：其他配置的 Responses Provider。

管理台按 Provider 分组显示模型；Key 的模型白名单保存这些规范 ID。

## 添加通用 Responses Provider

编辑 `/etc/mytoken/providers.json`，增加：

```json
{
  "id": "custom",
  "name": "Custom Provider",
  "protocol": "openai-responses",
  "baseUrl": "https://provider.example.com",
  "apiKeyFile": "/etc/mytoken/provider-secrets/custom",
  "enabled": true
}
```

然后执行：

```bash
sudo mytokenctl provider-set custom
sudo mytokenctl provider-reload
```

生产配置必须使用 HTTPS。普通模型 API Key 无法读取 Anthropic 组织费用等管理数据，因此管理台不会伪造上游余额。MyToken 展示的请求余额和 Token 预算是网关本地限制。
