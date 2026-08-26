# 安装指南

[English](INSTALLATION.md) | [简体中文](INSTALLATION.zh-CN.md)

## 支持的目标环境

需要使用 systemd 的 Linux 服务器、Node.js 22.13 或更新版本、npm，以及 root/sudo 权限。MyToken 不会在 macOS 或 Windows 上安装系统服务。

## 方式 A：通过 npm 引导安装——推荐

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview install
```

引导包会：

1. 解析精确的 npm preview 版本；
2. 将对应 Git Tag checkout 到 `/srv/mytoken-src`；
3. 校验 npm integrity、发布的 `gitHead`、源码 Origin 和 Commit；
4. 必要时安装固定兼容版本的 Codex CLI；
5. 执行格式、类型、Lint、测试、数据库、协议和构建检查；
6. 安装并启动 systemd 服务。

如果服务器使用同步较慢的 npm 镜像，请保留命令中的 `npm_config_registry`。

## 方式 B：通过 GitHub 源码安装

使用固定发布版本：

```bash
sudo git clone --branch v0.1.0-preview.4 --depth 1 \
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

GitHub 安装与 npm 引导使用同一套测试、备份、运行时暂存、systemd、健康检查和回滚逻辑。

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
```

可选外部 Provider：

```bash
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-status
```

## 更新

可以在管理台使用“系统 → 系统更新”，也可以运行：

```bash
sudo env \
  npm_config_registry=https://registry.npmjs.org \
  npx --yes mytoken-gateway@preview update
```

更新器会拒绝存在未提交修改的源码目录，校验拉取后的目标版本，创建一致性 SQLite 备份；健康检查失败时恢复旧运行版本。

## 验证

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
```

服务默认是私有的。应保持回环监听；如需远程访问，应额外配置 TLS 和身份认证层。
