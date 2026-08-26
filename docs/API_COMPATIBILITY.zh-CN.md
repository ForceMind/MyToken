# API 兼容性

[English](API_COMPATIBILITY.md) | [简体中文](API_COMPATIBILITY.zh-CN.md)

MyToken 实现经过明确说明的 OpenAI-compatible API 子集，并不是所有 OpenAI API 功能的完全替代品。

| 接口/能力                 | 状态           | 说明                                           |
| ------------------------- | -------------- | ---------------------------------------------- |
| `GET /v1/models`          | 支持           | 动态模型目录，并按 Key 模型策略过滤            |
| `POST /v1/responses` 文本 | 支持           | 推荐的标准接口                                 |
| Responses SSE             | 支持           | Codex 实时 Delta；外部 Provider 使用有界兼容流 |
| Function tools            | 部分支持       | 工具由调用客户端执行，不在网关服务器执行       |
| Tool choice               | 部分支持       | 只支持声明的 Function tools                    |
| Parallel tool calls       | 预览           | 有界并检查所有权                               |
| Previous response         | 进程内预览     | 绑定创建 Key，Worker 重启后失效                |
| Store                     | 只记录网关日志 | Codex Thread 始终为临时会话                    |
| Reasoning effort          | 按模型支持     | 只有模型公布支持时使用                         |
| Structured output         | 计划中         | 需要额外 Schema 契约测试                       |
| 图片、音频、文件          | V0.1 拒绝      | 不静默降级                                     |
| 内置 Web/File/Shell       | 拒绝           | 不通过公共 API 暴露                            |
| `/v1/chat/completions`    | 文本子集       | 支持文本消息和 SSE，不支持工具                 |

不同 Provider 的具体差异参见[模型 Provider](PROVIDERS.zh-CN.md)。客户端遇到未支持参数时应收到明确错误，而不是看似成功但实际忽略。
