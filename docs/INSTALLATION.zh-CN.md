# 安装指南

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

## 支持的目标环境

需要使用 systemd 的 Linux 服务器、Node.js 22.13 或更新版本、npm，以及 root/sudo 权限。MyToken 不会在 macOS 或 Windows 上安装系统服务。

## 通过 GitHub 源码安装——当前通道

使用固定发布版本：

```bash
sudo git clone --branch v0.1.0-preview.9 --depth 1 \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

使用最新主分支，适合开发和测试：

```bash
sudo git clone --branch main \
  https://github.com/ForceMind/MyToken.git /srv/mytoken-src
cd /srv/mytoken-src
sudo ./deploy/install.sh
```

安装器会执行格式、类型、Lint、测试、数据库、Codex 协议、构建、备份、运行时暂存、systemd、版本一致性、健康检查和回滚门禁。

## 第一次访问

在自己的电脑上转发服务器回环端口：

```bash
ssh -L 8080:127.0.0.1:8080 YOUR_USER@YOUR_SERVER
```

在服务器读取一次性 Token：

```bash
sudo mytokenctl bootstrap-token
```

打开 `http://127.0.0.1:8080`，初始化管理员，然后检查 Codex 和模型 Provider 状态。

## 配置模型

Codex 登录：

```bash
sudo mytokenctl codex-status
sudo mytokenctl codex-login
sudo mytokenctl codex-import root
```

“Codex 连接 → 导入 Linux 已有登录”及 `codex-import USER` 只支持该用户默认 `~/.codex` 中的文件型凭据。系统 Keyring 或自定义 `CODEX_HOME` 登录仍应使用专用设备码流程。

外部 Provider 可直接在“系统 → 模型 Providers”配置。页面支持 Claude、DeepSeek，以及自定义 Anthropic Messages、OpenAI Chat Completions 或 OpenAI Responses 服务。终端配置仍然可用：

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

## 更新

安装 preview.8 后，直接使用管理台“系统 → 系统更新”。特权更新器只从 GitHub `ForceMind/MyToken` 获取并校验不可变 Tag，不再查询或执行 npm。从旧的 npm 更新版本首次升级时执行：

```bash
cd /srv/mytoken-src
sudo git fetch --force --tags origin
sudo git checkout --detach v0.1.0-preview.9
sudo env MYTOKEN_SOURCE_DIR=/srv/mytoken-src ./deploy/install.sh
```

更新器会拒绝存在未提交修改的源码目录，校验拉取后的目标版本并创建一致性 SQLite 备份。任何部署失败都会同时恢复旧运行目录与发布派生环境变量；只有源码、部署包、环境变量、`/versionz`、`/version.json` 和实际 UI 入口版本一致才会报告成功。

## 验证

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl version-check
```

服务默认是私有的。应保持回环监听；如需远程访问，应额外配置 TLS 和身份认证层。
