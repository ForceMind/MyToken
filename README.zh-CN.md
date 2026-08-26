# MyToken Gateway

[English](README.md) | [简体中文](README.zh-CN.md)

MyToken Gateway 是部署在可信 Linux 服务器上的个人私有 AI 模型网关。它可以使用服务器本地的 Codex/ChatGPT 登录，也可以接入 Anthropic、DeepSeek 及其他兼容 OpenAI Responses API 的模型服务，然后为你自己的设备和程序签发受限制的 MyToken API Key。

> MyToken 是独立的个人私有网关，与 OpenAI、Anthropic、DeepSeek 不存在隶属、授权或官方合作关系。

## 主要能力

- 兼容 OpenAI 风格的 `GET /v1/models`、`POST /v1/responses` 和文本版 `POST /v1/chat/completions`；
- Codex Responses 与 Chat Completions 实时 SSE；
- 面向 OpenClaw 等 Responses 客户端的 Codex 函数工具回传流程；
- 动态获取 Codex、Claude、DeepSeek 和自定义 Provider 模型；
- 每个 Key 独立配置模型、IP/CIDR、RPM、每日请求、并发、总请求余额和 Token 预算；
- 记录 Key、IP、模型、延迟、Token、上下文、响应和错误；
- 管理台支持 Codex 登录、额度、Key、Provider、测试聊天、请求记录和系统状态；
- 管理台默认使用浅色主题，并支持持久化的深色模式切换；
- 通过受限 systemd 更新器在页面中安全触发更新；
- 网关使用临时 Codex Thread，不进入日常 Codex 对话列表。

## 环境要求

- 使用 systemd 的 Linux 服务器；
- Node.js 22.13 或更新版本及 npm；
- root 或 sudo 权限；
- 可信的个人私有部署环境。

安装器支持 OpenCloudOS/RHEL/Fedora 以及 Debian/Ubuntu 系列。API 默认只监听 `127.0.0.1:8080`。

## 通过 npm 安装——推荐

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview install
```

npm 包只是一个很小的引导 CLI。它会解析与版本对应的不可变 Git Tag，校验 npm integrity 和已发布的 Git commit，然后运行仓库中的安装器。

## 通过 GitHub 安装

使用发布 Tag，适合可重复部署：

```bash
sudo git clone --branch v0.1.0-preview.7 --depth 1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

使用最新 `main`，适合开发和测试：

```bash
sudo git clone --branch main \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

不要以 root 身份安装未经审核的 Fork 或分支。

## 第一次访问

服务默认只监听回环地址。在自己的电脑上执行：

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

在服务器读取一次性初始化 Token：

```bash
sudo mytokenctl bootstrap-token
```

然后打开 `http://127.0.0.1:8080`，创建管理员并进入“Codex 连接”。MyToken 会先检测服务器专用 Codex 登录，只有未登录时才显示登录入口。

也可以直接在服务器终端登录：

```bash
sudo mytokenctl codex-status
sudo mytokenctl codex-login
```

## 添加 Claude 或 DeepSeek

每个外部 Provider 都需要自己的上游 API Key；Codex 登录不能授权 Claude 或 DeepSeek。

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

Codex 为了兼容现有客户端继续使用裸模型 ID；Claude 使用 `anthropic/<model-id>`；DeepSeek 使用 `deepseek/<model-id>`；其他兼容 Provider 使用 `<provider>/<model-id>`。参见[模型 Provider](docs/PROVIDERS.zh-CN.md)。

## 更新

安装 preview.3 或更新版本后，可以在管理台进入“系统 → 系统更新”，也可以运行：

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview update
```

更新过程单任务运行，升级前备份并检查 SQLite，校验精确发布元数据，并将运行目录与发布派生环境变量作为同一个回滚单元。只有源码、部署包、环境变量、API 和 UI 五处版本完全一致才会报告成功。

## 常用运维命令

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl version-check
mytokenctl logs all
sudo mytokenctl backup
```

参见[终端运维](docs/OPERATIONS.md)和[安装指南](docs/INSTALLATION.zh-CN.md)。

## 开发验证

```bash
npm ci
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:security
npm run build
npm run db:check
npm run codex:check-contract
```

## 当前状态与安全提示

这是个人私有预览软件，不是公开商业 API 服务。Codex app-server 和动态工具桥包含实验性协议。网关会在发现 Codex 原生执行 Item 后立即中断，但目前还不能把它描述为经过证明的“执行前禁止”边界。请保持私有部署；如需远程访问，应使用 TLS 和额外身份认证；只向自己控制的设备签发 Key。

- [文档索引](docs/README.zh-CN.md)
- [架构](docs/ARCHITECTURE.zh-CN.md)
- [威胁模型](docs/THREAT_MODEL.zh-CN.md)
- [API 兼容性](docs/API_COMPATIBILITY.zh-CN.md)
- [部署](docs/DEPLOYMENT.md)

## 许可证

Apache License 2.0，参见 [LICENSE](LICENSE)。
