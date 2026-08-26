# 终端运维

[English](OPERATIONS.md) | [简体中文](OPERATIONS.zh-CN.md)

安装器会将 `mytokenctl` 放到 `/usr/local/sbin/mytokenctl`。只读命令可以使用普通 SSH 用户；改变服务状态、读取 Secret 或更新时需要 sudo。

## 服务状态

```bash
mytokenctl status
mytokenctl health
mytokenctl ready
mytokenctl doctor
mytokenctl version-check
mytokenctl permissions
```

```bash
sudo mytokenctl start
sudo mytokenctl stop
sudo mytokenctl restart
```

## 日志

```bash
mytokenctl logs all
mytokenctl logs api
mytokenctl logs worker
```

日志不应包含 Authorization、Cookie、完整 Key、Provider Key、Prompt 或原始推理。请求上下文只保存在受保护的本地数据库管理页面中。

## Codex

```bash
sudo mytokenctl codex-status
sudo mytokenctl codex-login
sudo mytokenctl codex-import root
```

服务始终使用 `mytoken-codex` 专用 `CODEX_HOME`。`codex-import USER` 只是显式、一次性、不解析内容地复制普通文件型 `auth.json`，不会让 Worker 指向源用户 Home。Helper 会校验路径、所有者、大小和目标登录状态，失败时恢复旧服务凭据。源用户与服务保留两个副本；如果上游刷新策略使副本失效，任一侧可能需要重新登录。

## Provider

优先在“系统 → 模型 Providers”中配置，也可以使用终端：

```bash
sudo mytokenctl provider-status
sudo mytokenctl provider-set anthropic
sudo mytokenctl provider-set deepseek
sudo mytokenctl provider-reload
```

## 数据库

```bash
mytokenctl db-check
sudo mytokenctl backup
```

备份会停止 API、执行 WAL Checkpoint 和 `integrity_check`，复制数据库后再次检查完整性，再恢复服务。

## 更新

安装 preview.8 后，推荐在管理台使用“系统 → 系统更新”。首次从旧版本升级执行：

```bash
cd /srv/mytoken-src
sudo git fetch --force --tags origin
sudo git checkout --detach v0.1.0-preview.9
sudo env MYTOKEN_SOURCE_DIR=/srv/mytoken-src ./deploy/install.sh
```

查看更新器：

```bash
systemctl status mytoken-update.path mytoken-update.service
journalctl -u mytoken-update.service
```

更新器只信任 `ForceMind/MyToken` GitHub Origin，获取并校验发布 Tag 与 `packages/cli/package.json` 版本，不执行 npm。任何部署失败都会把旧运行目录与发布派生环境变量一起恢复；只有源码、部署包、环境变量、API 与 UI 版本一致才报告成功。数据库只自动前滚，不自动执行未经测试的降级迁移。

## 第一次初始化

```bash
sudo mytokenctl bootstrap-token
```

管理员创建完成后该 Token 不再可用，命令也会拒绝再次显示。

完整命令和恢复细节以[英文运维文档](OPERATIONS.md)为准。
