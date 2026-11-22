# 2.7.5 部署记录（普通版 + 看板同号）

日期：2026-11-22
提交：`4fb48e66`；tag：`ordinary-news-v2.7.5`、`nas-dashboard-v2.7.5`

## 变更

- 普通版常驻调度每轮 tick 写精简日志 `data/scheduler/logs/<run_id>.json`（失败轮同样写），保留最近 500 份。
- 看板运行记录按 `run_id` 关联同名日志，展示阶段错误与当日摘要；表格新增「异常」列与「最近任务异常」展开。
- 版本口径：看板自本版起与普通版同号发布（`nas-dashboard-v2.7.5`）。

## 普通版

- 控制器 `--root` 必须是 `managed` 目录（传上一级会报 `controller_not_configured`）。
- 部署结果：`ordinary-news-v2.7.5` 激活，镜像 `sha256:d9791893b308e9d7deba5ed40736786710cd9d614ddfad59067cccdf77d914fc`。
- 部署后 `after_change` 自动重建调度容器，`data/scheduler/status.json` 显示 `version 2.7.5`、`mode resident`。

## 看板

- 构建：NAS 上 `docker build --build-arg NODE_IMAGE=node:24-bookworm-slim -f deploy/dashboard/Dockerfile`（默认 `node:24.14.1` 在 NAS 镜像源 401）。
- 镜像：`sha256:343b8289535af037ed81f78e2bc9c0d0228cfd99ad9a7c35a2b5d52026fd56da`，`compose.env` 已切换并保留 `compose.env.bak.*`。
- 两个容器 `healthy`；容器内校验收到的普通版数据 `scheduler.version = 2.7.5`。

## 回归修复：容器代理

- 现象：12:07 tick 报 `all_collection_sources_failed`，看板「异常」列可见。
- 根因：`ordinary.env` 的 `HTTP_PROXY/HTTPS_PROXY` 仍是 `127.0.0.1:7890`；去掉 `network_mode: host` 后容器内 127.0.0.1 指向自身，代理不可达。
- 处理：改为 `http://<user>:<pass>@192.168.31.10:7890`（`NO_PROXY` 保留），`ordinary.env.bak.*` 已备份；重启调度容器后容器内 `fetch` 返回 200。
