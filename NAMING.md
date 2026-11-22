# 命名规范

自 `ordinary-news-v2.7.10` / `nas-dashboard-v2.7.10` 起执行。目标是让 `docker ps` 一眼看出「属于哪个产品、干什么」，而不是把项目名、服务名、序号三段叠成 40 多个字符。

## 容器与 compose

命名模板：`etn-<产品>-<角色>`。

| 容器 | compose 项目 | 服务名 | 角色 | 常驻 |
|---|---|---|---|---|
| `etn-ordinary-scheduler` | `etn-ordinary` | `scheduler` | 常驻调度 + 采集/出刊 | 是 |
| `etn-dashboard-web` | `etn-dashboard` | `web` | 看板 Web/API（入站） | 是 |
| `etn-dashboard-collector` | `etn-dashboard` | `collector` | 抓取正文（纯出站、无凭据） | 是 |
| `etn-premium-run-<时间戳>` | 高级版 compose | 临时服务 | 高级版单轮执行 | 否（`run --rm`） |

规则：

1. 常驻服务必须写 `container_name`，不用 Docker 自动拼的 `<project>-<service>-<index>`；一次性 `run` 服务不写，避免与 `docker compose run` 冲突。
2. compose 顶层 `name:` 用短名，不复用长产品名；服务和容器名里不重复产品词（禁止 `dashboard-dashboard` 这类叠词）。
3. `container_name` 固定意味着不支持 `scale`。本项目所有服务都是单实例，这是刻意取舍。
4. 任何脚本、文档、告警引用容器名时使用上表名称；排障命令写成 `docker exec etn-dashboard-web …`。
5. 安装器/控制器判定「项目被占用」时，需同时校验 compose project label 与 `container_name`——固定名字的目的是唯一性，不是绕过冲突检测。

## 镜像

- 仓库名保留 `everyday-tech-news-ordinary` / `everyday-tech-news-dashboard`（控制器 `config.json` 与回滚历史依赖它，缩写收益小于改动风险，暂不改）。
- tag 必须与 GitHub tag 同名（`ordinary-news-v2.7.10`、`nas-dashboard-v2.7.10`），这是「三处版本号统一」的落点，不允许为了好看缩短。
- 线上只保留当前 + 上一版镜像用于回滚，其余按发布节奏清理（避免 `docker images` 里堆 9 个历史 tag）。

## 宿主机目录（冻结）

`/vol3/1000/Docker/everydaytechnews-ordinary`、`-managed`、`-dashboard`、`-runtime` 维持现名。cron 里有十余处绝对路径、控制器 `config.json`、`compose.env` 全部指向它们，改名只改善观感，代价是全链路断链；且不使用符号链接做兼容层。
