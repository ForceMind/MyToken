# 威胁模型

[English](THREAT_MODEL.md) | [简体中文](THREAT_MODEL.zh-CN.md)

## 受保护资产

- Codex 管理的 ChatGPT 凭据和账号访问；
- MyToken Key、管理员 Session、Session Secret 和 Key Pepper；
- Prompt、响应、工具定义、参数和结果；
- Claude、DeepSeek 等外部 Provider Key；
- 服务器文件系统、命令执行、网络和进程身份。

## 信任区域

1. 使用 MyToken Key 的客户端；
2. 使用服务端 Session 和 CSRF 的管理员浏览器；
3. 持有策略和数据库权限的 API 进程；
4. 持有 Codex 权限的 Worker；
5. Codex app-server 及专用空 Workspace；
6. 外部模型 Provider。

## 主要控制

- API 不读取 `auth.json`，也不能访问 Linux 用户 Home 或 Codex 服务 Home。只有管理员显式请求时，受限 root systemd Helper 才能从指定用户默认 `~/.codex` 复制不解析内容、非符号链接、所有者匹配且大小受限的 `auth.json` 到隔离服务目录；导入后由 Codex 验证，失败会恢复旧凭据。
- 完整 MyToken Key 不进入数据库；密码使用 Argon2id；Session 只保存摘要。
- Key 可以限制模型、IP/CIDR、RPM、每日请求、并发、请求余额和 Token 预算。
- 请求、结果、队列、SSE、工具和时间均有界。
- 外部 Provider Key 只由 API 进程读取，不进入日志或浏览器。
- 工具结果绑定 Key、Response、Worker Generation、Thread、Turn 和 Call ID。
- 服务默认监听回环地址；远程暴露需要 TLS、可信代理和额外身份层。

## 剩余风险

`codex app-server` 和动态工具仍包含实验性协议。Codex 原生执行 Item 是在开始事件出现后立即中断，这属于检测和缓解，不是经过证明的执行前禁止。工具状态目前主要在内存中，Worker 重启会使活动 continuation 失效。因此 MyToken 不能被描述为稳定的公共商业 API 服务。
