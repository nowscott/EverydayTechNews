# 更新日志

## ordinary-news-v2.7.34

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.34

- 修正部署校验归档文件：快照不包含 `state.sqlite3`，校验必须从 `state.json` 恢复；仅做轻量 checkpoint，避免再次完整重写 431MB。
- 与 2.7.33 的运行逻辑一致：NAS 本地轮次轻量 checkpoint，部署校验不再完整重写。
- 类型检查通过。

## nas-dashboard-v2.7.34

- 与三端同号；看板无变化。

## ordinary-news-v2.7.33

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.33

- NAS 本地轮次默认使用轻量 checkpoint：SQLite 为主状态，不再每 30 分钟重写 431MB `state.json`；每日 03:00 的分层清理仍执行完整 checkpoint 刷新归档状态。
- 部署校验改为读取一次 `state.json` 后核对 SQLite 的 `calls` / `issues` 行数，不再完整重写 `state.json` 和第二次 restore，显著缩短候选/旧版校验时间。
- 保留 2.7.32 的调度器陈旧锁修复与每日清理去重。
- 测试与类型检查通过。

## nas-dashboard-v2.7.33

- 与三端同号；看板无变化。

## ordinary-news-v2.7.32

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.32

- 修复调度器容器重启后的陈旧锁误判：`daemon.lock` 里的 PID 与新容器自身 PID 相同（常见为 8）时，视为陈旧锁并接管，不再进入 `already_running` 重启循环。
- 每日 03:00 分层清理增加“当天已执行”标记，避免 03:00 与后续补跑轮次重复重写账本。
- 测试覆盖同 PID 锁判断与清理标记。

## nas-dashboard-v2.7.32

- 与三端同号；看板无变化。

## ordinary-news-v2.7.31

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.31

- 原始 RSS/网页抓取缓存（`transient/raw/feeds`）改为真正的 7 天缓存：即使被证据清单登记，也按保留期删除，并把清单条目标记为 `expired`，避免伪装成“永远要保留的证据”。
- 维护期回收返回 `expired_feeds` 计数；最终刊正文、模型响应和已归档正文仍按原证据规则保留。
- 实测线上一次性回收 19,923 个旧 feed、约 4.0GB，`transient` 从 4.6GB 降到 776MB。
- 调度器本地轮次全部直接以 SQLite 为主状态，不再每轮重新解析 450–550MB `state.json`；这是 10:30/12:00 `collect` 一小时超时的直接原因。

## nas-dashboard-v2.7.31

- 与三端同号；看板无变化。

## ordinary-news-v2.7.30

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.30

- 新增数据分层保留：每日 03:00 维护窗口自动执行，临时抓取/评审/响应保留 7 天，评估快照保留 14 天，观测记录保留 30 天，未被最终采用的旧文章与任务保留 30/14 天；最终刊、投递回执、订阅配置与成本账本永久保留。
- 所有证据先查 `archive-manifests/objects.json`：仍在有效期内的正文、响应和原始抓取不会被误删；其余过期或未引用缓存按天回收。
- 新增 `retention` 命令，默认只输出 dry-run 计划；`--apply true` 才执行删除并重写账本。每日维护时自动应用一次，输出释放的文件数、字节数与数据库行数。
- 维护窗口的 transient 回收从 30 天收紧到 7 天，避免每天几十 GB 原始抓取长期堆积。

## nas-dashboard-v2.7.30

- 与三端同号；看板无变化。

## ordinary-news-v2.7.29

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.29

- 早报窗口 `enrich` 单轮草稿批量由 4 提到至少 8，05:00–06:15 能处理更多候选。
- 06:00 后仍不足最低篇数时，编辑门槛从 58 临时降到 55，并在刊标记 `editorial_floor: 55`、`degraded_editorial_floor: true`，避免直接生成 0 篇诊断刊。
- AI 兴趣词补充少量领先模型：Grok、混元、通义/千问、文心、豆包、SenseNova/商汤。
- 排序 `choose` 支持自定义最低分；测试覆盖 55 分兜底线与混元标签识别。

## nas-dashboard-v2.7.29

- 与三端同号；看板无变化。

## ordinary-news-v2.7.28

- 与三端同号；普通版逻辑未变。

## news-engine-v2.7.28

- 高级版早报改为短步骤、可续跑：每轮只推进 collect → assess → enrich → compose → deliver 中的一步，进度写入 `durable/mornings/<day>.json`，进程被超时杀掉或重启后从下一步继续，不再把整条早报压在一次 5 小时事务里。
- SQLite 设为运行期主状态：夜间完整 checkpoint 后写 `durable/sqlite-primary.json`，早报窗口内快速启动跳过 545MB `state.json` 回放。
- 早报窗口 checkpoint 改为轻量模式：只落 feeds 与对象清单，不每轮重写 545MB state.json，也不重写全部 responses。
- 调度节奏改为 04:00–06:15 每 5 分钟一步，06:15 组刊、06:30 投递；窗口内外超时分别 2 小时 / 60 分钟。
- 修复 `morningStep` 缺少 `existsSync` 导入导致首轮直接失败。

## nas-dashboard-v2.7.28

- 与三端同号；看板无变化。

## ordinary-news-v2.7.21

- 部署控制器把 `release_main_checks_not_passed`、`github_api_unavailable` 视为可重试的瞬时状态，不再写入 `blocked`；下次 `update` 会重新检查，不用手工清状态。

## news-engine-v2.7.21

- 与普通版共用同一版 `base-manage.ts`，发布检查行为一致。

## nas-dashboard-v2.7.21

- 与三端同号；看板无变化。

## ordinary-news-v2.7.20

- 修复常驻调度不持有 `runtime.lock` 导致 `deliver` 报 `ordinary_smtp_authority_required`：scheduler 启动时与 `main.ts` 一样用 `flock` 重入自身并设置 `ORDINARY_FLOCKED=1`，恢复 NAS 正式授权判定。
- 影响：2.7.18 部署后 2026-11-23 的早报投递被拒，`deliveries` 无记录、tick 摘要显示 `delivery: missed`。

## news-engine-v2.7.20

- 与三端同号；调度逻辑无变化。

## nas-dashboard-v2.7.20

- 与三端同号；看板无变化。

## ordinary-news-v2.7.19

- 夜间降噪：23:00–04:59 只保留 23:07、02:07、04:07 三轮；其余时段维持早高峰每 2 分钟、白天 :07/:37。
- 新增 `quietNow()`：部署后“先跑一轮”在夜间自动跳过，避免半夜启动即满载。
- `update` 新增夜间保护：23:00–08:00 默认返回 `deferred_night_window` 拒绝升级，`ETN_FORCE=1` 可强推。

## news-engine-v2.7.19

- 高级版夜间降为 23:00、03:00 两轮（原先每 30 分钟一轮），07–22 每 30 分钟，04–06:14 每 15 分钟。
- `nextRun` 改为 24 小时扫描，避免夜间跨 3 小时找不到可执行点。
- 部署后首轮在夜间跳过；`update` 同步夜间保护（`deferred_night_window`）。

## nas-dashboard-v2.7.19

- `upgrade.ts` 增加 `--force`；23:00–08:00 非 dry-run 默认拒绝构建，防止夜间构建占满 CPU。

## ordinary-news-v2.7.18

- 修正控制器自同步的两处问题：比较时按“改写后的内容”判断差异（避免 raw 相同就跳过改写）；普通版 `manage.ts` 落盘前把 `../nas/base-manage.ts` 改写为 `./base-manage.ts`，否则同步会把线上控制器改成无法启动的版本。
- 新增单测覆盖改写钩子与重复同步。

## news-engine-v2.7.18

- 与普通版共用同一版 `base-manage.ts`（同步比较逻辑修正），高级版控制器文件路径不变。

## nas-dashboard-v2.7.18

- 与三端同号发布；看板功能无变化，沿用 2.7.17 的 upgrade.ts 发布链。
## ordinary-news-v2.7.17

- `update` 自动同步控制器：发现 `managed/` 里的 `manage.ts`、`base-manage.ts`、`verify-state.ts` 与 release 不一致时，先备份到 `controller-backups/<tag>` 再覆盖，并更新 `controller.json` 哈希；不再需要每次手工 `--upgrade-controller`（2.7.17 本身仍需 bootstrap 一次）。
- `update` 增加阶段进度：`release_check → source → build → controller_synced → backup → validate_candidate → validate_previous → switch → done` 写入 `update-progress.json` 和一行 stdout，长跑时能看出在等什么。
- 锁按 PID 判活：`update.lock` 的持有进程已退出时立即回收，不再等满 1 小时；`update_already_running` 会附带 holder 与当前阶段。

## news-engine-v2.7.17

- 与普通版共用同一套控制器改动：自动同步控制器文件、阶段进度、锁按 PID 回收；高级版的控制器文件为 `deploy/nas/{manage.ts,base-manage.ts,verify-state.ts,compose.managed.yaml,compose.proxy.yaml}`。

## nas-dashboard-v2.7.17

- 新增 `deploy/dashboard/upgrade.ts`：一条命令完成「拉 tag 源码 → 构建镜像 → 记录 installation → 切换 compose → /api/health 版本校验」，失败自动恢复 `compose.env` 与 `installation.json` 并重启旧镜像。
- 升级时自动同步 `deploy/dashboard/compose.yaml`（与仓库不一致则备份后覆盖），解决“仓库改了线上不生效”。
- 新增 `--dry-run` 与 `--rollback`：先看计划再执行，回滚用上一条部署记录。
## ordinary-news-v2.7.16

- 与看板、高级版同号发布；普通版本身无功能改动，仅版本口径跟随。
- 安装器兼容补丁入库：NAS 已删除 `manage.py`/`base-manage.py`，控制器升级的备份、回滚与哈希计算改为“存在才处理”，不再中途卡住。

## nas-dashboard-v2.7.16

- 采集并入网页容器：删除 `etn-dashboard-collector`，`DASHBOARD_COLLECT=1` 时网页进程内启动采集循环（首轮即跑，之后 5 分钟一轮），常驻容器 2 → 1。
- `/api/health` 与启动日志的版本号改为读 `package.json`，不再硬编码 `1.4.3`。

## news-engine-v2.7.16

- compose 项目名 `everyday-tech-news-test` → `etn-premium`，容器名仍是 `etn-premium-scheduler`；控制器拉起调度前会摘掉旧项目同名容器，避免 `container_name` 冲突。
## ordinary-news-v2.7.15

- 看板：高级版“最近运行”改读 `/data/premium/scheduler/status.json`（cron 记录已停更），并复用同一套调度投影（含耗时、退出码、600s 超时阈值）。
- 看门狗升级：`scheduler-up` 除检查容器在跑，还校验 `scheduler/status.json` 心跳；心跳超过 5 分钟无更新（`heartbeat_stale`/`heartbeat_missing`）自动重启一次，正常时返回 `scheduler_healthy`。
- 看板用例修正：常驻调度用例改用相对当前时刻的时间戳，避免随真实时钟漂移误判 overdue。

## nas-dashboard-v2.7.15

- 高级版调度状态接入：`schedulerRun(component, status)` 把常驻调度 last_tick 投影为运行记录；高级版与普通版共用同一展示逻辑。
- 新增 `test/scheduler-run.test.ts`（4 项）与 fixture，锁定耗时/退出码/超时字段投影。

## news-engine-v2.7.15

- 单轮归档只打包当日证据（`store.archive(day())`），不再每次 gzip 全部 4.2GB 临时证据；配合 `pruneTransient`（默认 30 天、只删未登记为证据的 raw 缓存）。
- 常驻调度补 60 秒心跳（独立于轮次），看板与看门狗据此判断进程存活。
## ordinary-news-v2.7.14

- 版本口径收敛：普通版、NAS 看板、高级版引擎统一到同一版本号（本轮 `2.7.14`），三个组件各自仍用独立 tag 前缀（`ordinary-news-v` / `nas-dashboard-v` / `news-engine-v`）。
- 上一轮（2.7.13 / 0.7.11）已上线内容：调度启动即跑一轮、高级版 tmpfs/堆加固、高级版常驻调度 `etn-premium-scheduler`、健康检查代理探活、两个安装器迁 TS。

## nas-dashboard-v2.7.14

- 与普通版、高级版同号发布，看板逻辑沿用 2.7.13。

## news-engine-v2.7.14

- 版本号并入统一线（原 `0.7.11` → `2.7.14`），功能沿用 0.7.11 的常驻调度与超时整组回收；控制器版本高水位从 `[0,7,11]` 升到 `[2,7,14]`，仍按自身前缀取最新。
## news-engine-v0.7.11

- 调度子进程改为独立进程组并超时整组回收：此前超时只杀 `flock`，会留下仍持 `/data/pool.lock` 的 node 孤儿，下一轮只能排队等锁。
- 单轮超时默认 240s → 600s：4.2GB 归档 + 评估使完整一轮约 5 分钟，240s 会稳定误杀。
## ordinary-news-v2.7.13

- 调度启动即跑一轮：`scheduler.ts` 默认在进程启动后立刻执行一轮 tick（不再干等到下一个 :07/:37），`--no-startup-tick` 可关闭；部署完就能看到采集/归档结果。
- 高级版加固：`compose.managed.yaml` 的 `/tmp` tmpfs 由 128m 提到 1g、`NODE_OPTIONS=--max-old-space-size=2560`、`mem_limit` 3g→4g，`SQLITE_FULL` 与堆 OOM 同时消除。
- 高级版常驻调度：新增 `packages/news-engine/src/daemon.ts`（04:00–06:14 每 15 分钟、其余每 30 分钟），并以 `etn-premium-scheduler` 服务写进 compose，`restart: unless-stopped`；控制器 `afterChange` 激活后自动拉起该服务，crontab 不再写 ` run ` 行。
- 健康检查加代理探活：`health-check.ts` 从私有 env 读代理并 `curl --proxy` 探活，失败返回 `degraded_proxy_unreachable`，不再让死代理静默失败。
- 安装器去 Python：新增 `deploy/nas/install-managed.ts`、`deploy/ordinary/install-managed.ts`，行为与 `.py` 对齐（首次接管/`--upgrade-controller`/备份/回滚），并直接调用 TS 控制器；`check-version` 与 `tsc -p deploy/tsconfig.json` 均通过。

## nas-dashboard-v2.7.13

- 与 ordinary 同号发布，本轮看板逻辑无改动（沿用 2.7.12 的耗时/出刊时间/归档告警）。

## news-engine-v0.7.10

- 常驻调度 `daemon.ts` 进镜像，替代 `*/15` crontab；状态写 `data/scheduler/{status.json,runs,logs}`。
- 采集侧容器配置修正（tmpfs 1g、堆 2560、mem_limit 4g），修复 `database or disk is full` 与 OOM。
- 现场验证：修复后一轮 `run` exit=0，27 个来源 26 个成功、wall 8.1s（此前 27 源全 `fetch_or_parse_failed`）。

## ordinary-news-v2.7.12

- 运行记录器新增 `timeout_s` / `duration_ms` / `timed_out`，`--timeout` 可调（默认 600 秒）；看板任务表新增“耗时”列，超时标红。
- 看板新增“最近出刊成功时间”（只认 `delivery.completed` 的 `finished_at`）与“归档同步”状态。
- 归档告警：`archive_sync` 非 `synced` 立即告警，`synced` 但超过 36 小时未更新同样告警，避免再次出现积压 6 天才发现。
- 镜像治理：新增 `deploy/nas/prune-images.ts`（每个仓库保留最近 N 个 image id，被引用的镜像与运行中容器强制保留，默认只打印计划，`--cache` 才清构建缓存）。
- Python 回退件下线：NAS 上 `managed/{manage.py,base-manage.py}`、看板 `record-run.py`、`verify-live.py` 已移除；高级版健康检查迁到 `deploy/nas/health-check.ts`，etn 相关 cron 不再调用 python3。
- 已知问题（未修）：高级版 `health.ts` 在容器内触发 1.5GB 堆上限 OOM，`premium run` 持续 `exit_code=1`，属引擎侧内存问题，不在本次范围内。

## nas-dashboard-v2.7.12

- 任务表“耗时/超时标红”，概览新增“最近出刊成功”“归档同步”，归档状态异常进告警列表。

## ordinary-news-v2.7.11

- 修复 2.7.10 迁移暴露的双调度风险：`update` 全程写 `update.inprogress` 标记，cron 的 `scheduler-up` 看门狗命中标记时返回 `update_in_progress` 不再重建调度。
- 激活后新增 `sweepLegacy()`：清理旧命名项目（`everyday-tech-news-ordinary*`）遗留或看门狗复活的容器，避免新旧两份调度同时 tick 重复出刊。
- 现场记录：2.7.10 切换时恰逢 16:10 的看门狗，旧容器被按旧 active 重建，与新调度并行 14 分钟；已手工停机并清理，本例即回归测试用例 `deploy/ordinary/tests/test_update_marker.py`。

## nas-dashboard-v2.7.11

- 与普通版同号发布，无功能变更（仅版本号对齐）。

## ordinary-news-v2.7.10

- 容器命名统一：compose 项目 `everyday-tech-news-ordinary` → `etn-ordinary`，常驻调度固定 `container_name: etn-ordinary-scheduler`（原 `everyday-tech-news-ordinary-scheduler-1`）。
- 迁移方式是先停旧项目调度容器再激活新版本，避免新旧两个调度同时 tick 造成重复发信。
- 新增宿主 Node 运行时升级工具 `deploy/nas/runtime.ts`：`status`/`install [--check]`/`rollback`，按 `SHASUMS256.txt` 校验 sha256、解压后核对版本号、原子切换并保留旧目录。

## nas-dashboard-v2.7.10

- 容器命名统一：项目 `everyday-tech-news-dashboard` → `etn-dashboard`，服务 `dashboard|body-collector` → `web|collector`，容器固定为 `etn-dashboard-web`、`etn-dashboard-collector`（原 `everyday-tech-news-dashboard-dashboard-1`、`...-body-collector-1`）。
- 安装器占用保护升级：同时检查新旧项目名与固定 `container_name`，任一被其它目录占用即拒绝安装。

## ordinary-news-v2.7.9

- 看板安装器迁到 TS：`deploy/dashboard/install.ts`，新增 `--check` 只校验模式。
- 安装校验：镜像必须是 `sha256:` digest 且与 `docker image inspect` 一致；镜像内 `/app/package.json` 版本必须等于源码版本；业务数据与调度 cron 必须存在。
- 安全保护：`compose.yaml` 项目名固定，检测到同名项目已被其它目录占用时直接拒绝，避免把生产容器挪走；crontab 写入补齐结尾换行（否则 `crontab -` 拒绝）。

## ordinary-news-v2.7.8

- 运行记录器迁到 TS：`deploy/dashboard/record-run.ts` 取代 Python 版，输出字段、退出码传递与 127 启动失败记录完全一致（新增 Python/TS 对照测试）。
- 宿主侧命令已全部为 Node：控制器、运行记录器、归档 sync 均为 TS 入口；Python 脚本只保留为回退与安装器。

## ordinary-news-v2.7.7

- 修复 TS 控制器在 NAS 上调用 GitHub API 失败：子进程改用当前 node 可执行文件（PATH 里没有 node），并为子进程显式传环境。
- 控制器代理恢复：`managed/proxy.env` 指向可用出口，git 拉取与 API 调用走代理，避免直连 TLS 抖动。
- 宿主机 Node 24 运行时固定在 `/vol3/1000/Docker/everydaytechnews-runtime`；普通版与高级版 cron 均已切到 TS 控制器。

## ordinary-news-v2.7.6

- 控制器从 Python 迁到 TypeScript：`deploy/ordinary/manage.ts` + `deploy/nas/base-manage.ts`，宿主用固定 Node 运行时（`/vol3/1000/Docker/everydaytechnews-runtime/bin/node`），Python 版本保留为回退。
- 行为对齐：`status` 输出与 Python 完全一致，普通版账本哈希（sqlite）逐字节一致；新增 `ledger` 调试子命令与 Python/TS 对照测试。
- 安装器与 cron 入口改为 TS：`install-managed.py` 部署两个 .ts 文件（导入路径就地改写），`controller.json` 记录 node 路径；找不到 Node 时自动退回 Python。

## ordinary-news-v2.7.5

- 常驻调度每轮 tick 追加精简日志 `data/scheduler/logs/<run_id>.json`：错误阶段与原因、当日数量、投递结果、归档状态；与运行记录同号关联，保留最近 500 份。
- 失败 tick 也会留日志，便于事后定位；`--once` 同样生成。
- 版本口径调整：看板与普通版自本版起同号发布（看板 `nas-dashboard-v2.7.5`）。

## ordinary-news-v2.7.4

- 修复：控制器切到新版基类后，普通版部署校验误用了高级版 `verify-state.ts`（依赖 news-engine 的模块），导致 2.7.3 构建成功但校验阶段失败、未激活。现在普通版固定使用 `deploy/ordinary/verify-state.ts`，并有测试锁定。
- 2.7.3 的调度运行记录改动随本版一并上线。

## ordinary-news-v2.7.3

- 常驻调度每次 tick 按看板运行记录的同一格式原子写 `data/scheduler/runs/<run_id>.json` 与 `latest.json`（含 started_at / finished_at / state / exit_code），保留最近 500 份。
- 手动 `scheduler --once` 同样留记录，便于排障与对照。

## ordinary-news-v2.7.2

- 出刊调度迁入镜像内常驻进程 `scheduler.ts`：05–09 点每 2 分钟、其余 :07/:37 在进程内直接调用 `tick`，不再每轮创建一次性容器；策略单独放在 `schedule.ts` 并有单测覆盖跨小时、跨天边界。
- 控制器接入常驻调度：部署或回滚成功后自动拉起 `etn-ordinary-scheduler`；手动 `manage.py run` 会先停调度、跑完再拉起，避免两路并发写状态；新增 `scheduler-up` / `scheduler-down`，`status` 输出调度容器状态与最近一次 tick。
- crontab 只剩 `scheduler-up` 看门狗（每 10 分钟）、每小时 `update`、每天 4 次 `sync` 与周轮转；安装器模板同步。
- 调度状态落 `data/scheduler/status.json`（心跳、tick 计数、最近结果、下次触发），容器日志由 Docker 轮转。
- 顺手项：dashboard 正文采集器移出 host 网络（默认 bridge），`proxy.env` 的失效代理改为 `192.168.31.10:7890`；容器内实测 `fetch 200`、健康检查通过。

## ordinary-news-v2.7.1

- 出刊容器与归档发布器改用 Docker 默认 bridge 网络；实测 SMTP 465、Notion、GitHub 均可达，不再共享宿主网络栈。
- 移除 compose 中未被调用的 publisher 服务；归档发布统一由 `manage.py sync` 执行，避免两份参数漂移。
- 归档同步不再生成恒为空的 `archive.log`：容器输出进入 `commands.log`，stderr 进入 `sync.err`。
- 日志轮转脚本纳入仓库（`deploy/ordinary/rotate-logs.sh`），安装时部署到 `~/bin` 并挂周任务，覆盖 commands.log、sync.err、scheduler.log、updater.log。
- 安装器 cron 模板与实际调度对齐：05–09 点每 2 分钟、其余 :07/:37，每小时更新，每天 4 次归档同步。

## ordinary-news-v2.7.0

- 版本线从 1.0.x 切换为产品版本 v2.7.0（承接旧 Python 版 v2.6.4），后续在 2.7.x 上迭代；一个版本号贯穿 `release.json`、包版本、CHANGELOG、git tag 与 Docker 镜像 tag。
- 构建不再产生 `:git-<sha>` 镜像别名，提交号只写入 OCI label 与部署记录；清理时同时兼容旧的别名。
- 归档发布失败在 `archive_sync` 状态中写明 `error` 原因（如 `archive_github_403`、`archive_credential_missing`），不再只有 `archive_sync_failed`。
- 镜像不再安装未使用的 `util-linux`；调度容器去掉固定容器名，避免异常残留导致下一次启动失败。
- 归档发布器补 json-file 日志轮转（5m × 2）。
- NAS 调度频率调整：05–09 点每 2 分钟、其余时段 :07/:37 出刊唤醒；发布检查每小时；归档同步每天 06:40/08:40/12:40/20:40。

## news-engine-v0.7.9

- 整期审核身份仅包含业务输入，避免正文恢复附带的存储元数据导致已通过审核失效。

## news-engine-v0.7.8

- 每天保留最后一份完整选题评估报告，减少重复数据增长；不删除既有历史报告。
- 整期审核使用简短临时编号并在保存前还原原始身份；覆盖不完整时仅在费用已知、预算和次数允许的条件下重试同一批稿件。

## news-engine-v0.7.7

- 增加 Engadget 公开正文来源，为20条出刊目标提供更多跨来源候选；抓取要求可核对正文和发布时间。

## news-engine-v0.7.6

- 以 30 条合格候选为准备目标，最终最多发送 20 条；少于 15 条仍发送诊断，不降低事实审核标准。
- 增加爱范儿全文 RSS 与 TechCrunch 正文来源，优先生成符合最终来源与领域配额的稿件，再生成候补。
- 新稿件的长摘要目标为 150–220 字，短摘要目标为 80–120 字；原文信息不足时允许更短，历史稿件保留原来的校验规则。
- 修复样刊中审核响应格式异常后未继续复核、待审稿件占满来源配额的问题；保持审核标准与已有调用次数、预算和未知费用限制。
- 为本次明确授权的再次验收提供独立期号，仅发送到指定测试邮箱。
- 控制器升级时保留既有看板调度监控，避免覆盖已安装的任务包装。

## news-engine-v0.7.5

- 流式恢复和保存新闻状态，降低历史记录增长时的内存占用，避免计划任务内存耗尽。
- 高级版容器内存上限由 2 GiB 调整至 3 GiB，为采集和审核预留运行余量。
- 选题时复用已读取的来源记录，避免为历史版本重复加载完整数据。
- 新增独立的当日验收样刊，仅发送至明确授权的测试邮箱，不补发历史早报。

## ordinary-news-v1.0.8

- 收件人仅在连续三次 SMTP 收件人阶段永久拒收后标记异常；临时故障和不足三次的拒收不会更新订阅状态。
- SMTP 连接在 DATA 前关闭且未提供命令时，保留安全重试，暂停当前轮次，避免误判为发送结果未知。
- 即使后续发送恢复，私人账本仍保留该收件人的最近一次 SMTP 错误信息，便于排查。

## nas-dashboard-v2.7.9

- 安装器改为 TypeScript，带镜像 digest/版本校验与项目占用保护；版本随普通版同号。

## nas-dashboard-v2.7.8

- 运行记录器改为 `record-run.ts`（宿主执行），看板数据格式不变；版本随普通版同号。

## nas-dashboard-v2.7.7

- 版本随普通版同号发布；无界面变更。

## nas-dashboard-v2.7.6

- 版本随普通版同号发布；本版无界面变更，仅同步版本口径。

## nas-dashboard-v2.7.5

- 「邮件与运行记录」新增 `异常` 列，并可按 `最近任务异常` 展开查看每轮的阶段、错误与当日摘要（数据来自调度日志，仍做脱敏）。
- 版本号与普通版对齐，此后同号发布。

## nas-dashboard-v1.4.6

- 「邮件与运行记录」的任务执行记录合并普通版常驻调度 tick 记录（读取 `data/scheduler/runs`），出刊迁入常驻进程后不再停更。
- 「运行状态」普通版显示调度心跳与下次触发；最近任务以调度 `last_tick` 判断，心跳超时或停止中给出告警。
- 普通版运行逾期阈值跟随调度节奏：晨间 5 分钟、其余时段 35 分钟，不再按每 2 分钟的旧 cron 判断。

## nas-dashboard-v1.4.5

- 仅在普通版采集有更新的成功记录后，将既有采集错误视为已恢复，历史错误仍可查阅。

## news-engine-v0.7.4 / OpenWrt 网络迁移

- 新闻运行、归档、看板正文采集与版本控制器支持私有代理配置，也支持透明分流，不再默认使用本机旧代理。
- 普通版提供显式的版本控制器升级流程，保留控制器备份并锁定调度和归档。

## ordinary-news-v1.0.7 / nas-dashboard-v1.4.4

- 普通版每条 SMTP 连接发送最多 10 封，整批连接故障结束当前轮次并保留后续收件人，私人账本记录 SMTP 故障信息。
- 看板将一致性快照放到私有磁盘目录，并支持读取不超过 1 GiB 的数据库及 WAL。

## news-engine-v0.7.3

- 英文新品发布标题识别增加 announce；单独配色动态和普通 Show HN 项目适度降权，重要安全投稿不受该项降权。
- 定时写作使用当前候选顺序，不沿用待处理任务入队时的旧选题分；来源试评和 iPad mini 漏选分析见运行记录。

## news-engine-v0.7.2 / ordinary-news-v1.0.6

- NAS 私有收件人名单每日提前同步；Notion 临时故障经有限重试后，可使用七天内的完整备份，并记录来源与时间。
- 普通版 shadow 阶段不改变现有 GitHub Actions 正式发送，NAS 正式切换仍遵循现有迁移门槛。

## nas-dashboard-v1.4.3

- 统一首页、诊断告警和期刊列表的最新期刊排序，兼容缺少冻结时间的历史人工样刊；同时间修订按期刊编号排序，不改历史期刊或投递账本。

## nas-dashboard-v1.4.2

- 当日最新一期为诊断刊时，首页和运行状态明确提示未形成新闻早报；后续修订版正常出刊后不再用旧诊断刊触发提示。
## news-engine-v0.7.1

- 修复定时生成入口遗漏内测截止参数，长期内测在原2026-10-26到期日后不再误报trial_expired。
- 生成入口与调度、逐次请求统一使用trialDeadline(config)，限期内测到期、模型开关、运行窗口与每日预算继续生效。
- 新增生成入口跨旧到期日回归，以及限期到期、关闭模型、窗口边界和未知费用占用预算的离线测试。


## news-engine-v0.7.0 / nas-dashboard-v1.4.1

- HN定向支持公开非草稿GitHub Release、arXiv指定版本摘要；无版本论文固定v1，原文时间使用对应版本UTC提交时间。
- 保留原始快照、规范链接、材料类型与作者自述归因，不读取仓库首页/README、PDF、视频或社交正文，不跟随重定向；共用原有每轮12次补抓和执行时限。
- 看板原文区明确区分项目发布说明与预印本摘要；新材料继续经过原有证据、时效、预算和审核检查。
- 真实GitHub CLI发布记录与arXiv论文页面缩减快照纳入测试，覆盖版本不匹配、缺失日期、草稿、限流及批次上限。
## nas-dashboard-v1.4.0

- 新增「Token 与费用」独立页面，展示已知输入/输出、缓存命中、调用次数、估算费用、未知费用预留及重复调用消耗。
- 支持日期、处理环节、调用状态和关联标题筛选，每日趋势、环节分布与分页调用明细可追溯到新闻或冻结期刊。
- 复用只读安全快照；缺失用量明确标注，历史费用不重算，重复调用按完整任务历史判定。普通版不调用 AI。


## news-engine-v0.6.4 / nas-dashboard-v1.3.0

- 评估淘汰记录补充内容指纹，保留Python/Node选择行为一致；评分与淘汰理由按版本、日期匹配，不重算历史分数。
- 看板区分线索、未适配来源、证据不足、生成失败和当前稿件的审稿失败；真实零分与未记录评分分开显示。
- 新闻详情提供受控错误、按调用日期排序的尝试历史、后续校验恢复及有限重试说明；总览增加标明日期口径的处理漏斗和当日失败调用数。
- 看板继续只读、邮箱脱敏，并保留180天持久登录。

## news-engine-v0.6.3 / ordinary-news-v1.0.5

- 模型调用新增持久化分阶段诊断、时间、策略及受控错误码，原始响应继续归档。
- 生成和逐篇审稿共享已知费用校验修复，沿用原任务与三次上限；费用未知、证据过期、整刊审核和窗口预算限制不放宽。
- 请求明确长短摘要长度及仅从正文逐字引用的契约，修复请求带具体错误，不改任务缓存标识与历史稿件。
- 普通版投票失败补充解析/HTTP/超时诊断，不重写已有评分或期刊。
- 新增40个脱敏最小证据回归样本和审稿恢复边界测试。

## nas-dashboard-v1.2.2

- 登录有效期延长为180天，会话哈希持久保存，容器重启不再丢失登录；保留主动退出、密码变更失效与登录限流。

## nas-dashboard-v1.2.1

- 侧栏导航改用统一 SVG 线条图标，统一尺寸、线宽及文字对齐，适配手机并继承选中状态颜色。
## [news-engine-v0.6.2] - 2026-10-24

- 高级版内测收件人统一读取 Notion：状态正常且同时勾选高级订阅、高级内测；正式高级订阅继续使用原高级订阅资格。
- 各收件人独立邮件及持久化发送记录，部分失败、未知 SMTP 结果和重启不会重发给已处理邮箱；Notion 不可用时停止发送。
- 异常运维通知仍发给原管理员，测试标签、AI验收、预算和正式群发关闭保持原有配置。

本文件记录 EverydayTechNews 的重要版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [nas-dashboard-v1.2.0] - 2026-10-24

- 默认首页改为今日早报，展示最新冻结期刊、按本期顺序的5条精选和当天6条新抓取内容；原运行总览保留为运行状态页面。
- 邮件详情支持真实发送HTML的桌面/手机版式预览及脱敏收件版本切换，高级版校验冻结哈希，普通版读取发送账本，不重建历史邮件。
- 预览采用独立CSP及受限iframe，移除脚本、表单、外链资源和操作链接；缺失HTML或哈希异常时明确提示并保留文本查看。

## [nas-dashboard-v1.1.1] - 2026-10-24

- 将正常缺少人工收件确认记录标为“尚未人工确认收件”，不再计入数据来源缺失或读取失败告警。
- 前后端共用证据状态分类；必需文件缺失、确认文件损坏和数据库读取故障仍保留告警，不自动生成收件确认记录。

## [nas-dashboard-v1.1.0] - 2026-10-23

- 统一筛选下拉框的箭头位置、右侧留白和控件高度，保留原生键盘与触屏操作。
- 新增原文阅读、AI改写、评分与审核页签；复用已有来源正文，并明确标注摘要、待抓取和来源访问限制。
- 独立后台任务自动补抓公开正文并保存到看板自己的缓存；网页保持只读，业务数据库、模型调用及发送账本不变。

## [nas-dashboard-v1.0.0] - 2026-10-23

- 新增独立NAS局域网只读看板，包含普通版/高级版运行总览、新闻筛选和评分、AI改写/审核、费用、冻结期刊与脱敏发送账本。
- 独立密码登录与调度观察记录；业务数据只读挂载，不调用模型、SMTP或业务控制入口，不改变原有测试/生产模式。
- 增加固定镜像部署、健康检查、回滚说明、接口与只读状态回归测试。

## [news-engine-v0.6.1] - 2026-10-23

- 将高级版异常巡检放到NAS，正常不通知，未知费用/发送或出刊缺失时仅向测试邮箱发送一次通知；不依赖随身电脑。
- 兼容旧版已安装控制器的全局账本校验函数，长期测试配置工具保留原账本。

## [news-engine-v0.6.0] - 2026-10-23

- 增加用户显式授权的长期内部测试配置与独立离线迁移工具，保留单测试邮箱、2元日预算、付费/投递时段及原费用发送账本。
- 模型价格改为每次实时核验；新增7个研究/技术来源，短订阅摘要必须补取可信公开正文。
- GitHub主博客仅保留重要模型、智能体能力或严重漏洞，最多1条；常规管理更新在候选、缓存和付费边界剔除。

## [ordinary-news-v1.0.4] - 2026-10-23

- 修复IT之家七位数新闻编号被截断导致投票接口返回空响应的问题，旧Python与TypeScript保持一致。
- 三天迁移门槛增加有效投票证据，全评分失败的降级日不放行；不改写历史冻结期刊或发送记录。

## [ordinary-news-v1.0.3] - 2026-10-20

- 普通版控制器显式传入已挂载的数据目录，避免Compose命令覆盖默认参数后误用镜像内路径。
- 增加调度参数回归和实际Compose状态报告验证。

## [ordinary-news-v1.0.2] - 2026-10-20

- 修正私有NAS检出目录构建镜像时的代码读取权限，保持运行时以普通用户启动。
- 容器CI增加仅所有者可读的源码权限场景，共享模块同步保证容器内可读。

## [ordinary-news-v1.0.1] - 2026-10-20

- 普通版部署与回退校验改为逐行计算账本摘要，避免历史邮件增长导致内存峰值超出容器限制；状态schema与投递记录不变。
- 增加64MB JavaScript堆限制下的大型账本恢复校验。

## [ordinary-news-v1.0.0] - 2026-10-20

- 普通版新闻业务迁至独立TypeScript包和NAS组件，保留昨日新闻、IT之家投票排序、25条链接、通知、Notion订阅状态与45天退订协议。
- 新增逐收件人持久发送账本、SMTP提交阶段检测和未知结果保护；正式群发需通过连续三天测试、收件确认及受限归档凭据检查。
- 新增NAS本地调度、独立发布/回退、异步公开归档、运行报告与受控切换工具；旧普通版在观察期继续运行，高级版不受影响。
- 共用无产品限制的过滤、文本与Notion工具，Python业务代码保留为离线对照，不提前删除。

## [news-engine-v0.5.0] - 2026-10-20

- IT之家上限放宽为整期8条/重点2条，生成与组稿共用发布方策略。
- 保留兴趣加权，降低趣闻、社交关注、局部设施与常规候选版本排名；跨来源事件去重优先完整证据。
- 新增冻结前独立整期审稿，检查日期、数字、主体、确定性、重复事件及表达；剔除问题稿后从受审储备补足，未审或不足15条走诊断。
- 整期审稿共用既有预算、时段、费用预留与未知结果保护；不占新文章版本额度。
- NAS日报增加运行端/版本、内容分布、筛除原因、编辑评分与收件反馈状态；增加无网络的冻结期刊比较工具。
- 保留历史冻结邮件与账本、生产关闭及原试刊期限。规则、评分口径与验证边界见packages/news-engine/QUALITY.md。

## [2.6.4] - 2026-07-26

### 安全

- 将订阅网页的 Nodemailer 升级到 9.0.3，修复邮件 `raw` 选项可能绕过文件与 URL 访问限制的问题
- 更新 PostCSS、shell-quote、body-parser 及其上游依赖到已修复版本
- SMTP 传输层显式禁用文件和 URL 访问，防止邮件内容读取本地文件或远程 URL

## [2.6.3] - 2026-07-26

### 修复

- 邮件工作流改为每天上海时间 06:30 单次定时发送，移除不可靠的缓存去重，避免多个备用任务重复群发

## [2.6.2] - 2026-06-18

### 修复

- 新闻列表页抓取增加连接超时、读取超时和临时 HTTP 错误重试，降低源站或网络抖动导致的单次任务失败
- 列表页连续失败后自动降级到 IT之家同站 RSS，避免单一页面入口异常影响当天归档

### 文档

- README 补充当前抓取链路说明，并规划 RSS 摘要清洗、主题筛选和 AI 简报方向

### 测试

- 增加 RSS 解析、列表页超时重试和 RSS 兜底路径测试

## [2.6.1] - 2026-06-16

### 修复

- SMTP 在邮件正文提交阶段出现连接异常时不再自动重投同一封邮件，降低重复投递风险
- 每封日报增加稳定的 `Message-ID`，并避免随机退订 token 影响同一日报的消息标识

### 调度

- 手动触发全量发送时必须显式填写 `SEND_ALL`，避免误把测试任务发送给全部订阅者

## [2.6.0] - 2026-06-15

### 筛选

- 扩展指定主题及其关联词过滤，覆盖常见中英文名称、系统、芯片、终端和汽车生态写法
- 已排序归档在发送前再次应用最新过滤规则，并从后续排名补足邮件条目

### 邮件

- 邮件主题、HTML 标题、预览文本和正文头部统一显示上海当天日期
- 由邮件任务入口统一计算日期，避免主题与正文因时区或跨日产生差异

## [2.5.0] - 2026-06-15

### 性能

- 每批邮件只建立并登录一次 SMTP 连接，连接中断时自动重连，不再为每位订阅者重复握手
- 邮件工作流增加依赖缓存，并移除无用的 Git 配置与 pip 自升级步骤

### 调度

- 针对 GitHub `schedule` 的不确定延迟，改为上海时间 06:30、06:45 和 07:00 多次唤醒，最早成功的任务立即发送
- 移除 runner 内的长时间等待，并将任务超时上限从 210 分钟降至 30 分钟
- 使用按日期保存的 Actions 缓存标记跳过后续唤醒任务，避免同一天重复群发
- 群发步骤一旦启动，即使部分失败也记录当日已尝试，避免备用任务向成功收件人重复发送
- 手动单收件人测试不等待、不读取发送标记，继续立即执行

### 日志与隐私

- 移除逐封重复的成功日志，只保留匿名进度、阶段耗时、连接次数和最终汇总
- 测试与失败日志不再输出收件邮箱，异常订阅者仅使用序号定位
- 手动测试邮箱在进入任务环境前先由 Actions 掩码，避免出现在步骤环境摘要

## [2.4.1] - 2026-06-14

### 优化

- 调整移动端内容顺序，优先展示订阅表单，再展示补充说明与运行数据
- 优化订阅页与邮件在窄屏下的字号、留白、表单和按钮触控区域
- 订阅按钮和退订确认按钮在 320px、390px 窄屏下严格居中
- 根据连续无缺口的归档起点 `2024-06-04` 动态展示稳定运行天数
- 将早报黑色页脚中的退订入口改为高对比度浅色按钮

## [2.4.0] - 2026-06-14

### 新增

- 新订阅先写入 `待确认`，通过邮件签名链接确认后才更新为 `正常`
- 确认邮件展示签名链接的准确失效时间，默认有效期为 24 小时
- 确认完成后单独发送订阅成功邮件
- 每封早报增加按收件邮箱签名的退订按钮，退订链接有效期为 45 天
- 退订链接先进入确认页，用户主动确认后才将 Notion 状态更新为 `已退订`
- 退订用户可重新填写订阅表单，完成邮箱确认后恢复订阅

### 优化

- 重写每日早报 HTML，使用更适合邮箱客户端的内联样式与表格布局
- 为每条新闻增加序号和更清晰的阅读层级，统一通知区与页脚样式

## [2.3.0] - 2026-06-14

### 变更背景

原 `EmaiListInbox` 负责接收订阅并写入 Notion，EverydayTechNews 再从同一数据源读取订阅者并发送早报。分仓维护导致 Notion 字段、订阅状态、依赖、安全修复和部署说明逐渐不一致，因此将订阅服务迁入本仓库统一维护。

代码合并后仍保留独立运行边界：

- Python 抓取、排序和邮件发送由 GitHub Actions 运行
- React 订阅网页和 API 由 Vercel 部署
- 两端通过同一 Notion 数据源协作

### 新增

- 在 `apps/subscription-web` 中加入订阅网页与 Vercel API
- 增加邮箱去重、同实例并发保护、IP 限流、蜜罐和输入校验
- 新增 Web 自动测试及独立 GitHub Actions 工作流

### 变更

- 使用 React、TypeScript、Tailwind CSS v4 和 Vite 重写订阅网页
- Notion API 升级到 `2026-03-11` data source 接口
- 统一订阅端与发送端的 Notion 字段和状态约定
- Nodemailer 升级并清理 npm 依赖漏洞
- Vercel 运行环境升级至 Node.js 24

## [2.2.1] - 2026-06-14

### 修复

- 邮件定时任务改用显式 `Asia/Shanghai` 时区，每日 07:23 执行
- 增加邮件任务并发保护，避免定时任务和手动任务重叠发送
- 新闻文件缺失或没有有效条目时明确失败，不再静默显示成功

### 优化

- 避开整点和半点的 GitHub Actions 调度高峰
- Action 日志增加触发方式、UTC 时间和上海时间
- 邮件日志增加新闻文件、收件人数及成功/失败汇总

## [2.2.0] - 2026-06-13

### 性能

- 新闻评分改为直接请求 `https://dyn.ithome.com/grade/{新闻ID}`
- 使用最多 8 个并发请求完成评分，移除 Selenium、Chrome 和 ChromeDriver
- 保持原有评分公式与排序规则不变
- 相近规模的 GitHub Actions 排序耗时由约 210 秒降至 18.58 秒

### 测试与邮件

- 增加不读取或修改 Notion 的单收件人线上测试模式
- 将自动测试扩展到 26 项，覆盖评分接口解析、重试与过滤逻辑

## [2.1.0] - 2026-06-13

### 新增

- 建立统一新闻过滤模块 `src/news_filter.py`
- 扩展对主要货币符号、文字单位和数量级的识别
- 增加排序失败时的备用过滤机制和已排序文件检测
- 增加新闻 URL 与相似标题去重
- 增加 Notion 分页、空字段、重复邮箱和订阅状态处理
- 增加 SMTP 永久退信分类与订阅者异常状态更新
- 新增 21 项自动测试及 GitHub Actions 测试工作流

### 修复

- 修复排序页面超时导致整批任务失败
- 修复排序后归档继续追加、重复新闻和抓取失败假成功问题

### 变更

- 新闻列表抓取由 Selenium 改为 Requests + BeautifulSoup
- 拆分 Notion、SMTP、邮件内容与任务编排模块
- Python 固定为 `3.14`，GitHub Actions 升级到 Node 24 兼容版本
- Requests 升级到 `2.33.0`，修复 `CVE-2026-25645`
- 为抓取、排序和自动提交增加并发控制及推送前 rebase

## [2.0.0] - 2024-06-21

### 新增

- 增加每两小时运行一次的新闻抓取任务
- 新闻源调整为 IT之家
- 增加新闻归档、筛选和排序
- 使用 Notion 存储邮件订阅列表
- 搭配原 `EmaiListInbox` 项目提供订阅表单

### 变更

- 更新开源协议与 Fork 部署方式

## [1.0.0] - 2023-07-19

### 新增

- 发布首个正式版本
- 支持通过仓库 Secrets 配置发件邮箱、SMTP 密钥和服务器
- 支持 Fork 仓库后使用 GitHub Actions 部署每日科技新闻邮件

[2.6.2]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.6.2
[2.6.1]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.6.1
[2.6.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.6.0
[2.5.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.5.0
[2.4.1]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.4.1
[2.4.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.4.0
[2.3.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.3.0
[2.2.1]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.2.1
[2.2.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.2.0
[2.1.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.1.0
[2.0.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.0.0
[1.0.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v1.0.0

## News engine 0.4.0 — 2026-10-19

- Move the premium internal trial to a private authoritative NAS checkpoint with Linux locking and independent Docker runtime.
- Balance publishers, replace the inaccessible Tesla IR source with verified media article bodies, and migrate legacy drafts to automatic AI review.
- Add Git Release based NAS deployment, pinned image provenance, offline state checks, automatic updates outside the morning window, and code-only rollback.
- Keep private credentials and live billing/delivery state outside Git; retain the existing trial, spending and recipient boundaries.

## News engine 0.4.1 — 2026-10-19

- Fix the managed Compose tmpfs list so Docker can start the runtime container.
- Let morning news jobs retain the scheduler lock for their full engine-managed lifetime instead of the controller's 30-minute utility timeout.
- Exercise managed container startup in CI and support explicit, checked controller upgrades with backups.## ordinary-news-v2.7.27

- 与三端同号；普通版无变化。

## news-engine-v2.7.27

- 调度子进程超时按窗口调整：04–09 早报窗口 6 小时，其他时段 30 分钟；修复 600 秒超时在状态回放中途 SIGKILL、导致证据截断和整日失败。
- 证据对象改为临时文件 + fsync + rename 原子落盘，进程被杀死也不会留下 0 字节证据。

## nas-dashboard-v2.7.27

- 与三端同号；看板无变化。

## ordinary-news-v2.7.26

- 与三端同号；普通版运行无变化。

## news-engine-v2.7.26

- 发布控制器 `schema()` 只读 `durable/state.json` 文件头取 `schema_version`，不再整份解析 500MB+ 状态；修复大状态下 `release_requires_manual_data_migration` 误拦截。
- 不再把该误判写入 `blocked`。

## nas-dashboard-v2.7.26

- 与三端同号；看板无变化。

## ordinary-news-v2.7.25

- 与三端同号；普通版运行无变化。

## news-engine-v2.7.25

- 修复高级版常驻调度只跑维护模式：`daemon.ts` 调用 `main.ts run` 时显式传 `--maintenance-only false`，恢复早报采集、出刊与投递分支；此前每天 09:00 直接判定 `scheduler_missed_delivery_deadline`、`generated:0`。
- 健康检查改用流式抽取 `durable/state.json` 的 `calls` 数组，不再整份解析 500MB+ 状态，修复 `health_state_unreadable`。

## nas-dashboard-v2.7.25

- 与三端同号；看板无变化。

## ordinary-news-v2.7.24

- 依赖安全：`nodemailer` 10.1.3 → 10.6.1、`fast-xml-parser` 5.11.2 → 5.12.1，`npm audit` 运行时漏洞清零。
- 高级版镜像仓库默认名从 legacy `everyday-tech-news-test` 改为 `etn-premium`；历史/回滚 tag 仍按原仓库名匹配。

## news-engine-v2.7.24

- 依赖安全：`nodemailer` 10.6.1、`fast-xml-parser` 5.12.1；其余 6 个 moderate 均在 CI 专用的 `@actions/artifact` 链，不影响运行时。
- 镜像仓库名改为 `etn-premium`，本版起新镜像落在 `etn-premium:news-engine-v2.7.24`。

## nas-dashboard-v2.7.24

- 与三端同号；看板无变化。`subscription-web` 同步升级 vite/express/zod/concurrently，critical/high 清零。

## ordinary-news-v2.7.23

- 与三端同号；普通版运行无变化。

## news-engine-v2.7.23

- 与三端同号；高级版运行无变化。NAS 健康检查新增归档 GitHub token 探活（结果缓存 6 小时，失败返回 `degraded_archive_token`）。

## nas-dashboard-v2.7.23

- 采集限流参数外置：`DASHBOARD_COLLECT_MAX`、`DASHBOARD_COLLECT_INTERVAL_MS`、`DASHBOARD_COLLECT_BUDGET_MS`，默认值保持 60 / 300000 / 150000。
- 新增 `deploy/verify/verify-deploy.ts` 三端发版体检；镜像清理保留 active+上一版+legacy。

## ordinary-news-v2.7.22

- 与三端同号；普通版无变化。

## news-engine-v2.7.22

- 修复高级版调度无限重启：`daemon.lock` 里的 pid 必须确认是调度进程（`/proc/<pid>/cmdline` 命中 `daemon.ts`/`scheduler.ts`）才判定 `already_running`；容器重启后旧 pid 被复用或跨容器残留时直接接管。
- 现场已清掉 `data/scheduler/daemon.lock` 让 2.7.21 恢复运行，本版避免再次发生。

## nas-dashboard-v2.7.22

- 与三端同号；看板无变化。

## ordinary-news-v2.7.21

- 部署控制器把 `release_main_checks_not_passed`、`github_api_unavailable` 视为可重试的瞬时状态，不再写入 `blocked`；下次 `update` 会重新检查，不用手工清状态。

## news-engine-v2.7.21

- 与普通版共用同一版 `base-manage.ts`，发布检查行为一致。

## nas-dashboard-v2.7.21

- 与三端同号；看板无变化。

## ordinary-news-v2.7.20

- 修复常驻调度不持有 `runtime.lock` 导致 `deliver` 报 `ordinary_smtp_authority_required`：scheduler 启动时与 `main.ts` 一样用 `flock` 重入自身并设置 `ORDINARY_FLOCKED=1`，恢复 NAS 正式授权判定。
- 影响：2.7.18 部署后 2026-11-23 的早报投递被拒，`deliveries` 无记录、tick 摘要显示 `delivery: missed`。

## news-engine-v2.7.20

- 与三端同号；调度逻辑无变化。

## nas-dashboard-v2.7.20

- 与三端同号；看板无变化。

## ordinary-news-v2.7.19

- 夜间降噪：23:00–04:59 只保留 23:07、02:07、04:07 三轮；其余时段维持早高峰每 2 分钟、白天 :07/:37。
- 新增 `quietNow()`：部署后“先跑一轮”在夜间自动跳过，避免半夜启动即满载。
- `update` 新增夜间保护：23:00–08:00 默认返回 `deferred_night_window` 拒绝升级，`ETN_FORCE=1` 可强推。

## news-engine-v2.7.19

- 高级版夜间降为 23:00、03:00 两轮（原先每 30 分钟一轮），07–22 每 30 分钟，04–06:14 每 15 分钟。
- `nextRun` 改为 24 小时扫描，避免夜间跨 3 小时找不到可执行点。
- 部署后首轮在夜间跳过；`update` 同步夜间保护（`deferred_night_window`）。

## nas-dashboard-v2.7.19

- `upgrade.ts` 增加 `--force`；23:00–08:00 非 dry-run 默认拒绝构建，防止夜间构建占满 CPU。

## ordinary-news-v2.7.18

- 修正控制器自同步的两处问题：比较时按“改写后的内容”判断差异（避免 raw 相同就跳过改写）；普通版 `manage.ts` 落盘前把 `../nas/base-manage.ts` 改写为 `./base-manage.ts`，否则同步会把线上控制器改成无法启动的版本。
- 新增单测覆盖改写钩子与重复同步。

## news-engine-v2.7.18

- 与普通版共用同一版 `base-manage.ts`（同步比较逻辑修正），高级版控制器文件路径不变。

## nas-dashboard-v2.7.18

- 与三端同号发布；看板功能无变化，沿用 2.7.17 的 upgrade.ts 发布链。
## ordinary-news-v2.7.17

- `update` 自动同步控制器：发现 `managed/` 里的 `manage.ts`、`base-manage.ts`、`verify-state.ts` 与 release 不一致时，先备份到 `controller-backups/<tag>` 再覆盖，并更新 `controller.json` 哈希；不再需要每次手工 `--upgrade-controller`（2.7.17 本身仍需 bootstrap 一次）。
- `update` 增加阶段进度：`release_check → source → build → controller_synced → backup → validate_candidate → validate_previous → switch → done` 写入 `update-progress.json` 和一行 stdout，长跑时能看出在等什么。
- 锁按 PID 判活：`update.lock` 的持有进程已退出时立即回收，不再等满 1 小时；`update_already_running` 会附带 holder 与当前阶段。

## news-engine-v2.7.17

- 与普通版共用同一套控制器改动：自动同步控制器文件、阶段进度、锁按 PID 回收；高级版的控制器文件为 `deploy/nas/{manage.ts,base-manage.ts,verify-state.ts,compose.managed.yaml,compose.proxy.yaml}`。

## nas-dashboard-v2.7.17

- 新增 `deploy/dashboard/upgrade.ts`：一条命令完成「拉 tag 源码 → 构建镜像 → 记录 installation → 切换 compose → /api/health 版本校验」，失败自动恢复 `compose.env` 与 `installation.json` 并重启旧镜像。
- 升级时自动同步 `deploy/dashboard/compose.yaml`（与仓库不一致则备份后覆盖），解决“仓库改了线上不生效”。
- 新增 `--dry-run` 与 `--rollback`：先看计划再执行，回滚用上一条部署记录。
## ordinary-news-v2.7.16

- 与看板、高级版同号发布；普通版本身无功能改动，仅版本口径跟随。
- 安装器兼容补丁入库：NAS 已删除 `manage.py`/`base-manage.py`，控制器升级的备份、回滚与哈希计算改为“存在才处理”，不再中途卡住。

## nas-dashboard-v2.7.16

- 采集并入网页容器：删除 `etn-dashboard-collector`，`DASHBOARD_COLLECT=1` 时网页进程内启动采集循环（首轮即跑，之后 5 分钟一轮），常驻容器 2 → 1。
- `/api/health` 与启动日志的版本号改为读 `package.json`，不再硬编码 `1.4.3`。

## news-engine-v2.7.16

- compose 项目名 `everyday-tech-news-test` → `etn-premium`，容器名仍是 `etn-premium-scheduler`；控制器拉起调度前会摘掉旧项目同名容器，避免 `container_name` 冲突。
## ordinary-news-v2.7.15

- 看板：高级版“最近运行”改读 `/data/premium/scheduler/status.json`（cron 记录已停更），并复用同一套调度投影（含耗时、退出码、600s 超时阈值）。
- 看门狗升级：`scheduler-up` 除检查容器在跑，还校验 `scheduler/status.json` 心跳；心跳超过 5 分钟无更新（`heartbeat_stale`/`heartbeat_missing`）自动重启一次，正常时返回 `scheduler_healthy`。
- 看板用例修正：常驻调度用例改用相对当前时刻的时间戳，避免随真实时钟漂移误判 overdue。

## nas-dashboard-v2.7.15

- 高级版调度状态接入：`schedulerRun(component, status)` 把常驻调度 last_tick 投影为运行记录；高级版与普通版共用同一展示逻辑。
- 新增 `test/scheduler-run.test.ts`（4 项）与 fixture，锁定耗时/退出码/超时字段投影。

## news-engine-v2.7.15

- 单轮归档只打包当日证据（`store.archive(day())`），不再每次 gzip 全部 4.2GB 临时证据；配合 `pruneTransient`（默认 30 天、只删未登记为证据的 raw 缓存）。
- 常驻调度补 60 秒心跳（独立于轮次），看板与看门狗据此判断进程存活。
## ordinary-news-v2.7.14

- 版本口径收敛：普通版、NAS 看板、高级版引擎统一到同一版本号（本轮 `2.7.14`），三个组件各自仍用独立 tag 前缀（`ordinary-news-v` / `nas-dashboard-v` / `news-engine-v`）。
- 上一轮（2.7.13 / 0.7.11）已上线内容：调度启动即跑一轮、高级版 tmpfs/堆加固、高级版常驻调度 `etn-premium-scheduler`、健康检查代理探活、两个安装器迁 TS。

## nas-dashboard-v2.7.14

- 与普通版、高级版同号发布，看板逻辑沿用 2.7.13。

## news-engine-v2.7.14

- 版本号并入统一线（原 `0.7.11` → `2.7.14`），功能沿用 0.7.11 的常驻调度与超时整组回收；控制器版本高水位从 `[0,7,11]` 升到 `[2,7,14]`，仍按自身前缀取最新。
## news-engine-v0.7.11

- 调度子进程改为独立进程组并超时整组回收：此前超时只杀 `flock`，会留下仍持 `/data/pool.lock` 的 node 孤儿，下一轮只能排队等锁。
- 单轮超时默认 240s → 600s：4.2GB 归档 + 评估使完整一轮约 5 分钟，240s 会稳定误杀。
## ordinary-news-v2.7.13

- 调度启动即跑一轮：`scheduler.ts` 默认在进程启动后立刻执行一轮 tick（不再干等到下一个 :07/:37），`--no-startup-tick` 可关闭；部署完就能看到采集/归档结果。
- 高级版加固：`compose.managed.yaml` 的 `/tmp` tmpfs 由 128m 提到 1g、`NODE_OPTIONS=--max-old-space-size=2560`、`mem_limit` 3g→4g，`SQLITE_FULL` 与堆 OOM 同时消除。
- 高级版常驻调度：新增 `packages/news-engine/src/daemon.ts`（04:00–06:14 每 15 分钟、其余每 30 分钟），并以 `etn-premium-scheduler` 服务写进 compose，`restart: unless-stopped`；控制器 `afterChange` 激活后自动拉起该服务，crontab 不再写 ` run ` 行。
- 健康检查加代理探活：`health-check.ts` 从私有 env 读代理并 `curl --proxy` 探活，失败返回 `degraded_proxy_unreachable`，不再让死代理静默失败。
- 安装器去 Python：新增 `deploy/nas/install-managed.ts`、`deploy/ordinary/install-managed.ts`，行为与 `.py` 对齐（首次接管/`--upgrade-controller`/备份/回滚），并直接调用 TS 控制器；`check-version` 与 `tsc -p deploy/tsconfig.json` 均通过。

## nas-dashboard-v2.7.13

- 与 ordinary 同号发布，本轮看板逻辑无改动（沿用 2.7.12 的耗时/出刊时间/归档告警）。

## news-engine-v0.7.10

- 常驻调度 `daemon.ts` 进镜像，替代 `*/15` crontab；状态写 `data/scheduler/{status.json,runs,logs}`。
- 采集侧容器配置修正（tmpfs 1g、堆 2560、mem_limit 4g），修复 `database or disk is full` 与 OOM。
- 现场验证：修复后一轮 `run` exit=0，27 个来源 26 个成功、wall 8.1s（此前 27 源全 `fetch_or_parse_failed`）。

## ordinary-news-v2.7.12

- 运行记录器新增 `timeout_s` / `duration_ms` / `timed_out`，`--timeout` 可调（默认 600 秒）；看板任务表新增“耗时”列，超时标红。
- 看板新增“最近出刊成功时间”（只认 `delivery.completed` 的 `finished_at`）与“归档同步”状态。
- 归档告警：`archive_sync` 非 `synced` 立即告警，`synced` 但超过 36 小时未更新同样告警，避免再次出现积压 6 天才发现。
- 镜像治理：新增 `deploy/nas/prune-images.ts`（每个仓库保留最近 N 个 image id，被引用的镜像与运行中容器强制保留，默认只打印计划，`--cache` 才清构建缓存）。
- Python 回退件下线：NAS 上 `managed/{manage.py,base-manage.py}`、看板 `record-run.py`、`verify-live.py` 已移除；高级版健康检查迁到 `deploy/nas/health-check.ts`，etn 相关 cron 不再调用 python3。
- 已知问题（未修）：高级版 `health.ts` 在容器内触发 1.5GB 堆上限 OOM，`premium run` 持续 `exit_code=1`，属引擎侧内存问题，不在本次范围内。

## nas-dashboard-v2.7.12

- 任务表“耗时/超时标红”，概览新增“最近出刊成功”“归档同步”，归档状态异常进告警列表。

## ordinary-news-v2.7.11

- 修复 2.7.10 迁移暴露的双调度风险：`update` 全程写 `update.inprogress` 标记，cron 的 `scheduler-up` 看门狗命中标记时返回 `update_in_progress` 不再重建调度。
- 激活后新增 `sweepLegacy()`：清理旧命名项目（`everyday-tech-news-ordinary*`）遗留或看门狗复活的容器，避免新旧两份调度同时 tick 重复出刊。
- 现场记录：2.7.10 切换时恰逢 16:10 的看门狗，旧容器被按旧 active 重建，与新调度并行 14 分钟；已手工停机并清理，本例即回归测试用例 `deploy/ordinary/tests/test_update_marker.py`。

## nas-dashboard-v2.7.11

- 与普通版同号发布，无功能变更（仅版本号对齐）。

## ordinary-news-v2.7.10

- 容器命名统一：compose 项目 `everyday-tech-news-ordinary` → `etn-ordinary`，常驻调度固定 `container_name: etn-ordinary-scheduler`（原 `everyday-tech-news-ordinary-scheduler-1`）。
- 迁移方式是先停旧项目调度容器再激活新版本，避免新旧两个调度同时 tick 造成重复发信。
- 新增宿主 Node 运行时升级工具 `deploy/nas/runtime.ts`：`status`/`install [--check]`/`rollback`，按 `SHASUMS256.txt` 校验 sha256、解压后核对版本号、原子切换并保留旧目录。

## nas-dashboard-v2.7.10

- 容器命名统一：项目 `everyday-tech-news-dashboard` → `etn-dashboard`，服务 `dashboard|body-collector` → `web|collector`，容器固定为 `etn-dashboard-web`、`etn-dashboard-collector`（原 `everyday-tech-news-dashboard-dashboard-1`、`...-body-collector-1`）。
- 安装器占用保护升级：同时检查新旧项目名与固定 `container_name`，任一被其它目录占用即拒绝安装。

## ordinary-news-v2.7.9

- 看板安装器迁到 TS：`deploy/dashboard/install.ts`，新增 `--check` 只校验模式。
- 安装校验：镜像必须是 `sha256:` digest 且与 `docker image inspect` 一致；镜像内 `/app/package.json` 版本必须等于源码版本；业务数据与调度 cron 必须存在。
- 安全保护：`compose.yaml` 项目名固定，检测到同名项目已被其它目录占用时直接拒绝，避免把生产容器挪走；crontab 写入补齐结尾换行（否则 `crontab -` 拒绝）。

## ordinary-news-v2.7.8

- 运行记录器迁到 TS：`deploy/dashboard/record-run.ts` 取代 Python 版，输出字段、退出码传递与 127 启动失败记录完全一致（新增 Python/TS 对照测试）。
- 宿主侧命令已全部为 Node：控制器、运行记录器、归档 sync 均为 TS 入口；Python 脚本只保留为回退与安装器。

## ordinary-news-v2.7.7

- 修复 TS 控制器在 NAS 上调用 GitHub API 失败：子进程改用当前 node 可执行文件（PATH 里没有 node），并为子进程显式传环境。
- 控制器代理恢复：`managed/proxy.env` 指向可用出口，git 拉取与 API 调用走代理，避免直连 TLS 抖动。
- 宿主机 Node 24 运行时固定在 `/vol3/1000/Docker/everydaytechnews-runtime`；普通版与高级版 cron 均已切到 TS 控制器。

## ordinary-news-v2.7.6

- 控制器从 Python 迁到 TypeScript：`deploy/ordinary/manage.ts` + `deploy/nas/base-manage.ts`，宿主用固定 Node 运行时（`/vol3/1000/Docker/everydaytechnews-runtime/bin/node`），Python 版本保留为回退。
- 行为对齐：`status` 输出与 Python 完全一致，普通版账本哈希（sqlite）逐字节一致；新增 `ledger` 调试子命令与 Python/TS 对照测试。
- 安装器与 cron 入口改为 TS：`install-managed.py` 部署两个 .ts 文件（导入路径就地改写），`controller.json` 记录 node 路径；找不到 Node 时自动退回 Python。

## ordinary-news-v2.7.5

- 常驻调度每轮 tick 追加精简日志 `data/scheduler/logs/<run_id>.json`：错误阶段与原因、当日数量、投递结果、归档状态；与运行记录同号关联，保留最近 500 份。
- 失败 tick 也会留日志，便于事后定位；`--once` 同样生成。
- 版本口径调整：看板与普通版自本版起同号发布（看板 `nas-dashboard-v2.7.5`）。

## ordinary-news-v2.7.4

- 修复：控制器切到新版基类后，普通版部署校验误用了高级版 `verify-state.ts`（依赖 news-engine 的模块），导致 2.7.3 构建成功但校验阶段失败、未激活。现在普通版固定使用 `deploy/ordinary/verify-state.ts`，并有测试锁定。
- 2.7.3 的调度运行记录改动随本版一并上线。

## ordinary-news-v2.7.3

- 常驻调度每次 tick 按看板运行记录的同一格式原子写 `data/scheduler/runs/<run_id>.json` 与 `latest.json`（含 started_at / finished_at / state / exit_code），保留最近 500 份。
- 手动 `scheduler --once` 同样留记录，便于排障与对照。

## ordinary-news-v2.7.2

- 出刊调度迁入镜像内常驻进程 `scheduler.ts`：05–09 点每 2 分钟、其余 :07/:37 在进程内直接调用 `tick`，不再每轮创建一次性容器；策略单独放在 `schedule.ts` 并有单测覆盖跨小时、跨天边界。
- 控制器接入常驻调度：部署或回滚成功后自动拉起 `etn-ordinary-scheduler`；手动 `manage.py run` 会先停调度、跑完再拉起，避免两路并发写状态；新增 `scheduler-up` / `scheduler-down`，`status` 输出调度容器状态与最近一次 tick。
- crontab 只剩 `scheduler-up` 看门狗（每 10 分钟）、每小时 `update`、每天 4 次 `sync` 与周轮转；安装器模板同步。
- 调度状态落 `data/scheduler/status.json`（心跳、tick 计数、最近结果、下次触发），容器日志由 Docker 轮转。
- 顺手项：dashboard 正文采集器移出 host 网络（默认 bridge），`proxy.env` 的失效代理改为 `192.168.31.10:7890`；容器内实测 `fetch 200`、健康检查通过。

## ordinary-news-v2.7.1

- 出刊容器与归档发布器改用 Docker 默认 bridge 网络；实测 SMTP 465、Notion、GitHub 均可达，不再共享宿主网络栈。
- 移除 compose 中未被调用的 publisher 服务；归档发布统一由 `manage.py sync` 执行，避免两份参数漂移。
- 归档同步不再生成恒为空的 `archive.log`：容器输出进入 `commands.log`，stderr 进入 `sync.err`。
- 日志轮转脚本纳入仓库（`deploy/ordinary/rotate-logs.sh`），安装时部署到 `~/bin` 并挂周任务，覆盖 commands.log、sync.err、scheduler.log、updater.log。
- 安装器 cron 模板与实际调度对齐：05–09 点每 2 分钟、其余 :07/:37，每小时更新，每天 4 次归档同步。

## ordinary-news-v2.7.0

- 版本线从 1.0.x 切换为产品版本 v2.7.0（承接旧 Python 版 v2.6.4），后续在 2.7.x 上迭代；一个版本号贯穿 `release.json`、包版本、CHANGELOG、git tag 与 Docker 镜像 tag。
- 构建不再产生 `:git-<sha>` 镜像别名，提交号只写入 OCI label 与部署记录；清理时同时兼容旧的别名。
- 归档发布失败在 `archive_sync` 状态中写明 `error` 原因（如 `archive_github_403`、`archive_credential_missing`），不再只有 `archive_sync_failed`。
- 镜像不再安装未使用的 `util-linux`；调度容器去掉固定容器名，避免异常残留导致下一次启动失败。
- 归档发布器补 json-file 日志轮转（5m × 2）。
- NAS 调度频率调整：05–09 点每 2 分钟、其余时段 :07/:37 出刊唤醒；发布检查每小时；归档同步每天 06:40/08:40/12:40/20:40。

## news-engine-v0.7.9

- 整期审核身份仅包含业务输入，避免正文恢复附带的存储元数据导致已通过审核失效。

## news-engine-v0.7.8

- 每天保留最后一份完整选题评估报告，减少重复数据增长；不删除既有历史报告。
- 整期审核使用简短临时编号并在保存前还原原始身份；覆盖不完整时仅在费用已知、预算和次数允许的条件下重试同一批稿件。

## news-engine-v0.7.7

- 增加 Engadget 公开正文来源，为20条出刊目标提供更多跨来源候选；抓取要求可核对正文和发布时间。

## news-engine-v0.7.6

- 以 30 条合格候选为准备目标，最终最多发送 20 条；少于 15 条仍发送诊断，不降低事实审核标准。
- 增加爱范儿全文 RSS 与 TechCrunch 正文来源，优先生成符合最终来源与领域配额的稿件，再生成候补。
- 新稿件的长摘要目标为 150–220 字，短摘要目标为 80–120 字；原文信息不足时允许更短，历史稿件保留原来的校验规则。
- 修复样刊中审核响应格式异常后未继续复核、待审稿件占满来源配额的问题；保持审核标准与已有调用次数、预算和未知费用限制。
- 为本次明确授权的再次验收提供独立期号，仅发送到指定测试邮箱。
- 控制器升级时保留既有看板调度监控，避免覆盖已安装的任务包装。

## news-engine-v0.7.5

- 流式恢复和保存新闻状态，降低历史记录增长时的内存占用，避免计划任务内存耗尽。
- 高级版容器内存上限由 2 GiB 调整至 3 GiB，为采集和审核预留运行余量。
- 选题时复用已读取的来源记录，避免为历史版本重复加载完整数据。
- 新增独立的当日验收样刊，仅发送至明确授权的测试邮箱，不补发历史早报。

## ordinary-news-v1.0.8

- 收件人仅在连续三次 SMTP 收件人阶段永久拒收后标记异常；临时故障和不足三次的拒收不会更新订阅状态。
- SMTP 连接在 DATA 前关闭且未提供命令时，保留安全重试，暂停当前轮次，避免误判为发送结果未知。
- 即使后续发送恢复，私人账本仍保留该收件人的最近一次 SMTP 错误信息，便于排查。

## nas-dashboard-v2.7.9

- 安装器改为 TypeScript，带镜像 digest/版本校验与项目占用保护；版本随普通版同号。

## nas-dashboard-v2.7.8

- 运行记录器改为 `record-run.ts`（宿主执行），看板数据格式不变；版本随普通版同号。

## nas-dashboard-v2.7.7

- 版本随普通版同号发布；无界面变更。

## nas-dashboard-v2.7.6

- 版本随普通版同号发布；本版无界面变更，仅同步版本口径。

## nas-dashboard-v2.7.5

- 「邮件与运行记录」新增 `异常` 列，并可按 `最近任务异常` 展开查看每轮的阶段、错误与当日摘要（数据来自调度日志，仍做脱敏）。
- 版本号与普通版对齐，此后同号发布。

## nas-dashboard-v1.4.6

- 「邮件与运行记录」的任务执行记录合并普通版常驻调度 tick 记录（读取 `data/scheduler/runs`），出刊迁入常驻进程后不再停更。
- 「运行状态」普通版显示调度心跳与下次触发；最近任务以调度 `last_tick` 判断，心跳超时或停止中给出告警。
- 普通版运行逾期阈值跟随调度节奏：晨间 5 分钟、其余时段 35 分钟，不再按每 2 分钟的旧 cron 判断。

## nas-dashboard-v1.4.5

- 仅在普通版采集有更新的成功记录后，将既有采集错误视为已恢复，历史错误仍可查阅。

## news-engine-v0.7.4 / OpenWrt 网络迁移

- 新闻运行、归档、看板正文采集与版本控制器支持私有代理配置，也支持透明分流，不再默认使用本机旧代理。
- 普通版提供显式的版本控制器升级流程，保留控制器备份并锁定调度和归档。

## ordinary-news-v1.0.7 / nas-dashboard-v1.4.4

- 普通版每条 SMTP 连接发送最多 10 封，整批连接故障结束当前轮次并保留后续收件人，私人账本记录 SMTP 故障信息。
- 看板将一致性快照放到私有磁盘目录，并支持读取不超过 1 GiB 的数据库及 WAL。

## news-engine-v0.7.3

- 英文新品发布标题识别增加 announce；单独配色动态和普通 Show HN 项目适度降权，重要安全投稿不受该项降权。
- 定时写作使用当前候选顺序，不沿用待处理任务入队时的旧选题分；来源试评和 iPad mini 漏选分析见运行记录。

## news-engine-v0.7.2 / ordinary-news-v1.0.6

- NAS 私有收件人名单每日提前同步；Notion 临时故障经有限重试后，可使用七天内的完整备份，并记录来源与时间。
- 普通版 shadow 阶段不改变现有 GitHub Actions 正式发送，NAS 正式切换仍遵循现有迁移门槛。

## nas-dashboard-v1.4.3

- 统一首页、诊断告警和期刊列表的最新期刊排序，兼容缺少冻结时间的历史人工样刊；同时间修订按期刊编号排序，不改历史期刊或投递账本。

## nas-dashboard-v1.4.2

- 当日最新一期为诊断刊时，首页和运行状态明确提示未形成新闻早报；后续修订版正常出刊后不再用旧诊断刊触发提示。
## news-engine-v0.7.1

- 修复定时生成入口遗漏内测截止参数，长期内测在原2026-10-26到期日后不再误报trial_expired。
- 生成入口与调度、逐次请求统一使用trialDeadline(config)，限期内测到期、模型开关、运行窗口与每日预算继续生效。
- 新增生成入口跨旧到期日回归，以及限期到期、关闭模型、窗口边界和未知费用占用预算的离线测试。


## news-engine-v0.7.0 / nas-dashboard-v1.4.1

- HN定向支持公开非草稿GitHub Release、arXiv指定版本摘要；无版本论文固定v1，原文时间使用对应版本UTC提交时间。
- 保留原始快照、规范链接、材料类型与作者自述归因，不读取仓库首页/README、PDF、视频或社交正文，不跟随重定向；共用原有每轮12次补抓和执行时限。
- 看板原文区明确区分项目发布说明与预印本摘要；新材料继续经过原有证据、时效、预算和审核检查。
- 真实GitHub CLI发布记录与arXiv论文页面缩减快照纳入测试，覆盖版本不匹配、缺失日期、草稿、限流及批次上限。
## nas-dashboard-v1.4.0

- 新增「Token 与费用」独立页面，展示已知输入/输出、缓存命中、调用次数、估算费用、未知费用预留及重复调用消耗。
- 支持日期、处理环节、调用状态和关联标题筛选，每日趋势、环节分布与分页调用明细可追溯到新闻或冻结期刊。
- 复用只读安全快照；缺失用量明确标注，历史费用不重算，重复调用按完整任务历史判定。普通版不调用 AI。


## news-engine-v0.6.4 / nas-dashboard-v1.3.0

- 评估淘汰记录补充内容指纹，保留Python/Node选择行为一致；评分与淘汰理由按版本、日期匹配，不重算历史分数。
- 看板区分线索、未适配来源、证据不足、生成失败和当前稿件的审稿失败；真实零分与未记录评分分开显示。
- 新闻详情提供受控错误、按调用日期排序的尝试历史、后续校验恢复及有限重试说明；总览增加标明日期口径的处理漏斗和当日失败调用数。
- 看板继续只读、邮箱脱敏，并保留180天持久登录。

## news-engine-v0.6.3 / ordinary-news-v1.0.5

- 模型调用新增持久化分阶段诊断、时间、策略及受控错误码，原始响应继续归档。
- 生成和逐篇审稿共享已知费用校验修复，沿用原任务与三次上限；费用未知、证据过期、整刊审核和窗口预算限制不放宽。
- 请求明确长短摘要长度及仅从正文逐字引用的契约，修复请求带具体错误，不改任务缓存标识与历史稿件。
- 普通版投票失败补充解析/HTTP/超时诊断，不重写已有评分或期刊。
- 新增40个脱敏最小证据回归样本和审稿恢复边界测试。

## nas-dashboard-v1.2.2

- 登录有效期延长为180天，会话哈希持久保存，容器重启不再丢失登录；保留主动退出、密码变更失效与登录限流。

## nas-dashboard-v1.2.1

- 侧栏导航改用统一 SVG 线条图标，统一尺寸、线宽及文字对齐，适配手机并继承选中状态颜色。
## [news-engine-v0.6.2] - 2026-10-24

- 高级版内测收件人统一读取 Notion：状态正常且同时勾选高级订阅、高级内测；正式高级订阅继续使用原高级订阅资格。
- 各收件人独立邮件及持久化发送记录，部分失败、未知 SMTP 结果和重启不会重发给已处理邮箱；Notion 不可用时停止发送。
- 异常运维通知仍发给原管理员，测试标签、AI验收、预算和正式群发关闭保持原有配置。

本文件记录 EverydayTechNews 的重要版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [nas-dashboard-v1.2.0] - 2026-10-24

- 默认首页改为今日早报，展示最新冻结期刊、按本期顺序的5条精选和当天6条新抓取内容；原运行总览保留为运行状态页面。
- 邮件详情支持真实发送HTML的桌面/手机版式预览及脱敏收件版本切换，高级版校验冻结哈希，普通版读取发送账本，不重建历史邮件。
- 预览采用独立CSP及受限iframe，移除脚本、表单、外链资源和操作链接；缺失HTML或哈希异常时明确提示并保留文本查看。

## [nas-dashboard-v1.1.1] - 2026-10-24

- 将正常缺少人工收件确认记录标为“尚未人工确认收件”，不再计入数据来源缺失或读取失败告警。
- 前后端共用证据状态分类；必需文件缺失、确认文件损坏和数据库读取故障仍保留告警，不自动生成收件确认记录。

## [nas-dashboard-v1.1.0] - 2026-10-23

- 统一筛选下拉框的箭头位置、右侧留白和控件高度，保留原生键盘与触屏操作。
- 新增原文阅读、AI改写、评分与审核页签；复用已有来源正文，并明确标注摘要、待抓取和来源访问限制。
- 独立后台任务自动补抓公开正文并保存到看板自己的缓存；网页保持只读，业务数据库、模型调用及发送账本不变。

## [nas-dashboard-v1.0.0] - 2026-10-23

- 新增独立NAS局域网只读看板，包含普通版/高级版运行总览、新闻筛选和评分、AI改写/审核、费用、冻结期刊与脱敏发送账本。
- 独立密码登录与调度观察记录；业务数据只读挂载，不调用模型、SMTP或业务控制入口，不改变原有测试/生产模式。
- 增加固定镜像部署、健康检查、回滚说明、接口与只读状态回归测试。

## [news-engine-v0.6.1] - 2026-10-23

- 将高级版异常巡检放到NAS，正常不通知，未知费用/发送或出刊缺失时仅向测试邮箱发送一次通知；不依赖随身电脑。
- 兼容旧版已安装控制器的全局账本校验函数，长期测试配置工具保留原账本。

## [news-engine-v0.6.0] - 2026-10-23

- 增加用户显式授权的长期内部测试配置与独立离线迁移工具，保留单测试邮箱、2元日预算、付费/投递时段及原费用发送账本。
- 模型价格改为每次实时核验；新增7个研究/技术来源，短订阅摘要必须补取可信公开正文。
- GitHub主博客仅保留重要模型、智能体能力或严重漏洞，最多1条；常规管理更新在候选、缓存和付费边界剔除。

## [ordinary-news-v1.0.4] - 2026-10-23

- 修复IT之家七位数新闻编号被截断导致投票接口返回空响应的问题，旧Python与TypeScript保持一致。
- 三天迁移门槛增加有效投票证据，全评分失败的降级日不放行；不改写历史冻结期刊或发送记录。

## [ordinary-news-v1.0.3] - 2026-10-20

- 普通版控制器显式传入已挂载的数据目录，避免Compose命令覆盖默认参数后误用镜像内路径。
- 增加调度参数回归和实际Compose状态报告验证。

## [ordinary-news-v1.0.2] - 2026-10-20

- 修正私有NAS检出目录构建镜像时的代码读取权限，保持运行时以普通用户启动。
- 容器CI增加仅所有者可读的源码权限场景，共享模块同步保证容器内可读。

## [ordinary-news-v1.0.1] - 2026-10-20

- 普通版部署与回退校验改为逐行计算账本摘要，避免历史邮件增长导致内存峰值超出容器限制；状态schema与投递记录不变。
- 增加64MB JavaScript堆限制下的大型账本恢复校验。

## [ordinary-news-v1.0.0] - 2026-10-20

- 普通版新闻业务迁至独立TypeScript包和NAS组件，保留昨日新闻、IT之家投票排序、25条链接、通知、Notion订阅状态与45天退订协议。
- 新增逐收件人持久发送账本、SMTP提交阶段检测和未知结果保护；正式群发需通过连续三天测试、收件确认及受限归档凭据检查。
- 新增NAS本地调度、独立发布/回退、异步公开归档、运行报告与受控切换工具；旧普通版在观察期继续运行，高级版不受影响。
- 共用无产品限制的过滤、文本与Notion工具，Python业务代码保留为离线对照，不提前删除。

## [news-engine-v0.5.0] - 2026-10-20

- IT之家上限放宽为整期8条/重点2条，生成与组稿共用发布方策略。
- 保留兴趣加权，降低趣闻、社交关注、局部设施与常规候选版本排名；跨来源事件去重优先完整证据。
- 新增冻结前独立整期审稿，检查日期、数字、主体、确定性、重复事件及表达；剔除问题稿后从受审储备补足，未审或不足15条走诊断。
- 整期审稿共用既有预算、时段、费用预留与未知结果保护；不占新文章版本额度。
- NAS日报增加运行端/版本、内容分布、筛除原因、编辑评分与收件反馈状态；增加无网络的冻结期刊比较工具。
- 保留历史冻结邮件与账本、生产关闭及原试刊期限。规则、评分口径与验证边界见packages/news-engine/QUALITY.md。

## [2.6.4] - 2026-07-26

### 安全

- 将订阅网页的 Nodemailer 升级到 9.0.3，修复邮件 `raw` 选项可能绕过文件与 URL 访问限制的问题
- 更新 PostCSS、shell-quote、body-parser 及其上游依赖到已修复版本
- SMTP 传输层显式禁用文件和 URL 访问，防止邮件内容读取本地文件或远程 URL

## [2.6.3] - 2026-07-26

### 修复

- 邮件工作流改为每天上海时间 06:30 单次定时发送，移除不可靠的缓存去重，避免多个备用任务重复群发

## [2.6.2] - 2026-06-18

### 修复

- 新闻列表页抓取增加连接超时、读取超时和临时 HTTP 错误重试，降低源站或网络抖动导致的单次任务失败
- 列表页连续失败后自动降级到 IT之家同站 RSS，避免单一页面入口异常影响当天归档

### 文档

- README 补充当前抓取链路说明，并规划 RSS 摘要清洗、主题筛选和 AI 简报方向

### 测试

- 增加 RSS 解析、列表页超时重试和 RSS 兜底路径测试

## [2.6.1] - 2026-06-16

### 修复

- SMTP 在邮件正文提交阶段出现连接异常时不再自动重投同一封邮件，降低重复投递风险
- 每封日报增加稳定的 `Message-ID`，并避免随机退订 token 影响同一日报的消息标识

### 调度

- 手动触发全量发送时必须显式填写 `SEND_ALL`，避免误把测试任务发送给全部订阅者

## [2.6.0] - 2026-06-15

### 筛选

- 扩展指定主题及其关联词过滤，覆盖常见中英文名称、系统、芯片、终端和汽车生态写法
- 已排序归档在发送前再次应用最新过滤规则，并从后续排名补足邮件条目

### 邮件

- 邮件主题、HTML 标题、预览文本和正文头部统一显示上海当天日期
- 由邮件任务入口统一计算日期，避免主题与正文因时区或跨日产生差异

## [2.5.0] - 2026-06-15

### 性能

- 每批邮件只建立并登录一次 SMTP 连接，连接中断时自动重连，不再为每位订阅者重复握手
- 邮件工作流增加依赖缓存，并移除无用的 Git 配置与 pip 自升级步骤

### 调度

- 针对 GitHub `schedule` 的不确定延迟，改为上海时间 06:30、06:45 和 07:00 多次唤醒，最早成功的任务立即发送
- 移除 runner 内的长时间等待，并将任务超时上限从 210 分钟降至 30 分钟
- 使用按日期保存的 Actions 缓存标记跳过后续唤醒任务，避免同一天重复群发
- 群发步骤一旦启动，即使部分失败也记录当日已尝试，避免备用任务向成功收件人重复发送
- 手动单收件人测试不等待、不读取发送标记，继续立即执行

### 日志与隐私

- 移除逐封重复的成功日志，只保留匿名进度、阶段耗时、连接次数和最终汇总
- 测试与失败日志不再输出收件邮箱，异常订阅者仅使用序号定位
- 手动测试邮箱在进入任务环境前先由 Actions 掩码，避免出现在步骤环境摘要

## [2.4.1] - 2026-06-14

### 优化

- 调整移动端内容顺序，优先展示订阅表单，再展示补充说明与运行数据
- 优化订阅页与邮件在窄屏下的字号、留白、表单和按钮触控区域
- 订阅按钮和退订确认按钮在 320px、390px 窄屏下严格居中
- 根据连续无缺口的归档起点 `2024-06-04` 动态展示稳定运行天数
- 将早报黑色页脚中的退订入口改为高对比度浅色按钮

## [2.4.0] - 2026-06-14

### 新增

- 新订阅先写入 `待确认`，通过邮件签名链接确认后才更新为 `正常`
- 确认邮件展示签名链接的准确失效时间，默认有效期为 24 小时
- 确认完成后单独发送订阅成功邮件
- 每封早报增加按收件邮箱签名的退订按钮，退订链接有效期为 45 天
- 退订链接先进入确认页，用户主动确认后才将 Notion 状态更新为 `已退订`
- 退订用户可重新填写订阅表单，完成邮箱确认后恢复订阅

### 优化

- 重写每日早报 HTML，使用更适合邮箱客户端的内联样式与表格布局
- 为每条新闻增加序号和更清晰的阅读层级，统一通知区与页脚样式

## [2.3.0] - 2026-06-14

### 变更背景

原 `EmaiListInbox` 负责接收订阅并写入 Notion，EverydayTechNews 再从同一数据源读取订阅者并发送早报。分仓维护导致 Notion 字段、订阅状态、依赖、安全修复和部署说明逐渐不一致，因此将订阅服务迁入本仓库统一维护。

代码合并后仍保留独立运行边界：

- Python 抓取、排序和邮件发送由 GitHub Actions 运行
- React 订阅网页和 API 由 Vercel 部署
- 两端通过同一 Notion 数据源协作

### 新增

- 在 `apps/subscription-web` 中加入订阅网页与 Vercel API
- 增加邮箱去重、同实例并发保护、IP 限流、蜜罐和输入校验
- 新增 Web 自动测试及独立 GitHub Actions 工作流

### 变更

- 使用 React、TypeScript、Tailwind CSS v4 和 Vite 重写订阅网页
- Notion API 升级到 `2026-03-11` data source 接口
- 统一订阅端与发送端的 Notion 字段和状态约定
- Nodemailer 升级并清理 npm 依赖漏洞
- Vercel 运行环境升级至 Node.js 24

## [2.2.1] - 2026-06-14

### 修复

- 邮件定时任务改用显式 `Asia/Shanghai` 时区，每日 07:23 执行
- 增加邮件任务并发保护，避免定时任务和手动任务重叠发送
- 新闻文件缺失或没有有效条目时明确失败，不再静默显示成功

### 优化

- 避开整点和半点的 GitHub Actions 调度高峰
- Action 日志增加触发方式、UTC 时间和上海时间
- 邮件日志增加新闻文件、收件人数及成功/失败汇总

## [2.2.0] - 2026-06-13

### 性能

- 新闻评分改为直接请求 `https://dyn.ithome.com/grade/{新闻ID}`
- 使用最多 8 个并发请求完成评分，移除 Selenium、Chrome 和 ChromeDriver
- 保持原有评分公式与排序规则不变
- 相近规模的 GitHub Actions 排序耗时由约 210 秒降至 18.58 秒

### 测试与邮件

- 增加不读取或修改 Notion 的单收件人线上测试模式
- 将自动测试扩展到 26 项，覆盖评分接口解析、重试与过滤逻辑

## [2.1.0] - 2026-06-13

### 新增

- 建立统一新闻过滤模块 `src/news_filter.py`
- 扩展对主要货币符号、文字单位和数量级的识别
- 增加排序失败时的备用过滤机制和已排序文件检测
- 增加新闻 URL 与相似标题去重
- 增加 Notion 分页、空字段、重复邮箱和订阅状态处理
- 增加 SMTP 永久退信分类与订阅者异常状态更新
- 新增 21 项自动测试及 GitHub Actions 测试工作流

### 修复

- 修复排序页面超时导致整批任务失败
- 修复排序后归档继续追加、重复新闻和抓取失败假成功问题

### 变更

- 新闻列表抓取由 Selenium 改为 Requests + BeautifulSoup
- 拆分 Notion、SMTP、邮件内容与任务编排模块
- Python 固定为 `3.14`，GitHub Actions 升级到 Node 24 兼容版本
- Requests 升级到 `2.33.0`，修复 `CVE-2026-25645`
- 为抓取、排序和自动提交增加并发控制及推送前 rebase

## [2.0.0] - 2024-06-21

### 新增

- 增加每两小时运行一次的新闻抓取任务
- 新闻源调整为 IT之家
- 增加新闻归档、筛选和排序
- 使用 Notion 存储邮件订阅列表
- 搭配原 `EmaiListInbox` 项目提供订阅表单

### 变更

- 更新开源协议与 Fork 部署方式

## [1.0.0] - 2023-07-19

### 新增

- 发布首个正式版本
- 支持通过仓库 Secrets 配置发件邮箱、SMTP 密钥和服务器
- 支持 Fork 仓库后使用 GitHub Actions 部署每日科技新闻邮件

[2.6.2]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.6.2
[2.6.1]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.6.1
[2.6.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.6.0
[2.5.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.5.0
[2.4.1]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.4.1
[2.4.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.4.0
[2.3.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.3.0
[2.2.1]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.2.1
[2.2.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.2.0
[2.1.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.1.0
[2.0.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v2.0.0
[1.0.0]: https://github.com/NowScott/EverydayTechNews/releases/tag/v1.0.0

## News engine 0.4.0 — 2026-10-19

- Move the premium internal trial to a private authoritative NAS checkpoint with Linux locking and independent Docker runtime.
- Balance publishers, replace the inaccessible Tesla IR source with verified media article bodies, and migrate legacy drafts to automatic AI review.
- Add Git Release based NAS deployment, pinned image provenance, offline state checks, automatic updates outside the morning window, and code-only rollback.
- Keep private credentials and live billing/delivery state outside Git; retain the existing trial, spending and recipient boundaries.

## News engine 0.4.1 — 2026-10-19

- Fix the managed Compose tmpfs list so Docker can start the runtime container.
- Let morning news jobs retain the scheduler lock for their full engine-managed lifetime instead of the controller's 30-minute utility timeout.
- Exercise managed container startup in CI and support explicit, checked controller upgrades with backups.## 2.7.22（2026-03-02 续：调度锁自愈）

- 高级版调度：`daemon.lock` 里的 pid 必须确认是调度进程（`/proc/<pid>/cmdline` 命中 daemon.ts/scheduler.ts）才认为已在运行；容器重启后旧 pid 被复用或跨容器持有时直接接管，不再无限 `already_running` 重启。
