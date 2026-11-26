# 控制器迁移到 TypeScript（2.7.6 → 2.7.7）

> 历史记录：文中提及的 `manage.py`、`record-run.py`、Python 测试与「找不到 Node 时回退 Python」都已在 2.7.34 撤除，现状以 `deploy/ordinary/README.md` 为准。

日期：2026-11-22
tag：`ordinary-news-v2.7.6`、`ordinary-news-v2.7.7`、`nas-dashboard-v2.7.6`、`nas-dashboard-v2.7.7`

## 为什么

宿主机 Python 控制器每次操作都要起解释器并重复读包，且与镜像内 TS 运行时代码分裂。迁移后控制器与业务同为 TS，部署链路只依赖 Node 24 一处运行时。

## 运行时

- Node 24.22.3 安装在 `/vol3/1000/Docker/everydaytechnews-runtime`（官方 linux-x64 包，经镜像站下载）。
- cron 调用：`<runtime>/bin/node --disable-warning=ExperimentalWarning <managed>/manage.ts --root <managed>`。
- Python 版 `manage.py` / `base-manage.py` 全部保留，安装器找不到 Node 时自动回退。

## 实现要点

- `deploy/nas/base-manage.ts`：版本比较 / 发布选择 / 保护时段 / 原子写 / 互斥锁 / 源与构建 / 校验 / 激活 / 剪枝 / 更新 / 运行 / 回滚；高级版 CLI 为 `deploy/nas/manage.ts`。
- `deploy/ordinary/manage.ts`：普通版覆盖 schema、sqlite 账本、快照（`VACUUM INTO`）、常驻调度控制、`sync`；额外提供 `ledger` 调试子命令。
- 锁由 flock 改为独占锁文件（含 pid + mtime 过期判定），语义保持“是否拿到锁”。
- GitHub API 子进程用 `process.execPath`（NAS PATH 里没有 node），并显式透传环境；代理来自 `managed/proxy.env`。

## 验证

- 本地：`deploy/tsconfig.json` typecheck；`deploy/ordinary/tests/test_ts_controller.py` 对照 `status` 输出与账本哈希（逐字节一致）。
- NAS：同一份 `managed` 目录下 Python 与 TS `status` 输出 `equal True`；普通版与高级版均一致。
- 真实部署：TS 控制器执行 `update` 从 2.7.5 → 2.7.6 → 2.7.7，`checks=offline_state_and_ledger_passed`。
- 调度：2.7.7 后 12:37 tick `status=completed`、`exit_code=0`、25 条、SMTP accepted、归档 synced。
- 高级版：12:37 由 TS 控制器经 `record-run.py` 触发，容器日志 `engine=typescript`。

## 踩坑

- TS 首次 `update` 报 `github_api_unavailable`：子进程 `spawn('node')` 在 NAS 不存在 → 改 `process.execPath`。
- 随后 `command_failed:git`：直连 GitHub TLS 抖动 → 恢复 `managed/proxy.env`（`192.168.31.10:7890` 带凭据），git 与 API 均走代理。
