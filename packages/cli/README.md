# mytoken-gateway

[English](#english) | [简体中文](#简体中文)

## English

Installer and operations bootstrap for [MyToken Gateway](https://github.com/ForceMind/MyToken), a private AI model gateway for Codex, Claude, DeepSeek, and compatible Chat/Responses providers.

> Preview software. MyToken is independent and is not affiliated with, endorsed by, or operated by OpenAI, Anthropic, or DeepSeek.

### Requirements

- Linux server with systemd
- Node.js 22.13 or newer and npm
- root or sudo access

### Historical npm bootstrap

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview install
```

The npm development channel is paused after preview.7. Use the GitHub tag below for current builds.

### Install from GitHub

```bash
sudo git clone --branch v0.1.0-preview.9 --depth 1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

### First access

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
sudo mytokenctl bootstrap-token
```

Open `http://127.0.0.1:8080`.

### Update

After preview.8 is installed, **System → System update** updates directly from GitHub tags. For the first upgrade:

```bash
cd /srv/mytoken-src
sudo git fetch --force --tags origin
sudo git checkout --detach v0.1.0-preview.9
sudo env MYTOKEN_SOURCE_DIR=/srv/mytoken-src ./deploy/install.sh
```

### Operations

```bash
mytokenctl status
mytokenctl doctor
mytokenctl version-check
mytokenctl codex-status
sudo mytokenctl codex-import root
sudo mytokenctl backup
```

The npm package contains only the bootstrap CLI, this README, and the Apache-2.0 license. The application source is fetched from the matching Git tag and verified against npm release metadata before installation.

## 简体中文

[MyToken Gateway](https://github.com/ForceMind/MyToken) 的安装和运维引导包。MyToken 是面向 Codex、Claude、DeepSeek 和兼容 Chat/Responses Provider 的个人私有 AI 模型网关。

> 这是预览软件。MyToken 与 OpenAI、Anthropic、DeepSeek 不存在隶属、授权或官方合作关系。

### 环境要求

- 使用 systemd 的 Linux 服务器
- Node.js 22.13 或更新版本及 npm
- root 或 sudo 权限

### 历史 npm 引导包

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview install
```

npm 开发通道在 preview.7 后暂停，当前版本请使用下面的 GitHub Tag。

### 通过 GitHub 安装

```bash
sudo git clone --branch v0.1.0-preview.9 --depth 1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

### 第一次访问

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
sudo mytokenctl bootstrap-token
```

然后打开 `http://127.0.0.1:8080`。

### 更新

安装 preview.8 后，管理台“系统 → 系统更新”会直接使用 GitHub Tag。首次升级请执行：

```bash
cd /srv/mytoken-src
sudo git fetch --force --tags origin
sudo git checkout --detach v0.1.0-preview.9
sudo env MYTOKEN_SOURCE_DIR=/srv/mytoken-src ./deploy/install.sh
```

### 常用运维

```bash
mytokenctl status
mytokenctl doctor
mytokenctl version-check
mytokenctl codex-status
sudo mytokenctl codex-import root
sudo mytokenctl backup
```

npm 包只包含引导 CLI、本 README 和 Apache-2.0 许可证。安装时会从匹配的 Git Tag 获取应用源码，并根据 npm 发布元数据校验后再执行。
