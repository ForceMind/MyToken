# 架构

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md)

```text
管理员浏览器 / OpenClaw / AI 客户端
                 |
                 | HTTPS + 管理员 Session 或 MyToken Key
                 v
            mytoken-api
    Key / 策略 / 日志 / SQLite / Provider Router
           |                         |
           | Unix Socket             +--> Anthropic Messages API
           v                         +--> DeepSeek / 其他 Responses API
      mytoken-worker
      协议适配 / 工具桥
           |
           | stdio JSONL JSON-RPC
           v
      codex app-server
```

## 依赖方向

- Shared Package 只包含数据契约和纯工具。
- API 层处理公共接口、Key 策略、限额、日志和 Provider 路由，不依赖 Codex app-server 字段。
- Worker 层依赖固定版本的 Codex 协议契约，将它转换成内部事件。
- Worker 只暴露固定 Unix Socket 路由，不接受任意 JSON-RPC Method。

## 凭据隔离

- `mytoken-api` 不能读取 Codex Home。
- `mytoken-worker` 不能读取 API 数据库、管理员密码、Session Secret、Key Pepper 或外部 Provider Key。
- Codex Token 不跨过 Worker 边界。
- Claude、DeepSeek 等 Key 只存在于 API 专用 Secret 目录。

## 工具边界

客户端声明的 Function Tool 通过动态工具协议返回调用客户端执行。只有 Key 开启工具权限且调用属于该 Key 的活动 Response 时才允许。Codex 原生命令、文件、MCP、Web、Process 等 Item 会触发安全中断。
