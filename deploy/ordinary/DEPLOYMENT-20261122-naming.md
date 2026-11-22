# 2.7.10 容器命名统一部署记录（2026-11-22）

## 目标

`docker ps` 在不看 compose 文件的情况下能读出「哪个产品、什么角色」，并把固定名字后的冲突检测补上。

## 改动

- compose 项目：`everyday-tech-news-ordinary`→`etn-ordinary`，`everyday-tech-news-dashboard`→`etn-dashboard`。
- 容器：`everyday-tech-news-ordinary-scheduler-1`→`etn-ordinary-scheduler`；`everyday-tech-news-dashboard-dashboard-1`→`etn-dashboard-web`；`...-body-collector-1`→`etn-dashboard-collector`。
- 服务名：`dashboard|body-collector`→`web|collector`（一次性 `ordinary` 服务不设 `container_name`，避免与 `compose run` 冲突）。
- `deploy/dashboard/install.ts`：占用保护同时校验新旧项目 label 与固定 `container_name`，命中即 `dashboard_project_in_use` / `dashboard_container_in_use`。
- 新增 `NAMING.md` 与 `apps/nas-dashboard/test/naming.test.ts`（命名回归锁定）。

## 迁移顺序（关键：避免双份 tick）

1. 旧项目 `everyday-tech-news-ordinary` 容器先 `stop scheduler` 再 `down`，确保新项目起容器时没有第二份调度在跑——否则同一分钟两套调度都会出刊并发信。
2. 看板先 `down` 旧项目（旧 compose + 备份 env），再 `up -d --wait` 新项目；3080 中断约 5 秒。
3. 普通版 `down` 后再执行控制器 `update`，新项目容器由控制器 `up -d --no-deps scheduler` 拉起。

注意 compose 插值依赖 `ORDINARY_IMAGE`/`ORDINARY_ROOT`/`ORDINARY_UID`/`ORDINARY_GID`，手工 `docker compose` 命令必须显式传这四个变量，否则报 `required variable ... is missing`；env 文件是 `/vol3/1000/Docker/everydaytechnews-ordinary/ordinary.env`，不是 `managed/` 下的路径。

## 验证

| 项 | 结果 |
|---|---|
| `docker ps` 名字 | `etn-ordinary-scheduler`、`etn-dashboard-web`、`etn-dashboard-collector` |
| 看板 health | 200，容器内 `package.json` 2.7.10 |
| 看板读到调度 | `read_state ok`，`scheduler.version 2.7.10`，`mode resident` |
| 普通版 | `ordinary-news-v2.7.10` / `e886d32c` / `sha256:d6d47e47…`，`status deployed` |
| 首个 tick | 见下（16:37） |
| 安装器占用保护 | `--check` 新目录返回 `dashboard_project_in_use:etn-dashboard:/vol3/.../everydaytechnews-dashboard` |
| 本地测试 | 普通 37 + 看板 40（含命名 4 项）+ Python 对照 16/4 全通过 |

## 回滚

- 看板：`compose.yaml.bak.<ts>` + `compose.env.bak.<ts>` 恢复后 `up -d --wait`，镜像 digest 退回 `6acc6618…`。
- 普通版：控制器 `rollback ordinary-news-v2.7.9`，但注意旧 tag 的 compose 项目名仍是长名，回滚后容器名会变回 `everyday-tech-news-ordinary-scheduler-1`（版本回滚与命名回滚是两件事）。
