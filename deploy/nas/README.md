# 飞牛 NAS 高级版测试部署

适用 N100 / x86-64，Docker Compose v2。只有高级版进入本容器，普通版和订阅网页继续独立运行。无需入站端口。NAS 需要能访问来源站点、Notion、模型接口、SMTP 和镜像源。

## 首次验证

在 NAS 的独立应用目录放置本仓库，不使用既有备份目录作为运行目录。以下命令从仓库根目录执行：

```sh
cp deploy/nas/.env.example deploy/nas/.env
mkdir -p deploy/nas/data
# 将 .env 中 NAS_UID / NAS_GID 改成 id 命令显示的值，并确保 data 属于该用户。
chmod 700 deploy/nas/data
chmod 600 deploy/nas/.env
docker compose -f deploy/nas/compose.yaml build --pull
docker compose -f deploy/nas/compose.yaml run --rm premium init
docker compose -f deploy/nas/compose.yaml run --rm premium status
```

首次 init 创建关闭的试刊。默认没有密钥；status 不访问模型或 SMTP。配置 .env 后可用 `maintenance` 检查真实来源采集，它不调用模型、不发送邮件，但会更新本地状态。不要将这份空白试运行状态当作现有内测账本。

## 现有内测接管

必须单写：暂停私有 Actions 调度并确认所有正在运行的任务结束，才取得最终状态。初期 NAS 冒烟验证可使用独立空白 data；接管时将其原样备份到另一个目录，不与正式迁入数据混合。

1. 在可信电脑取得私有数据仓库的最终快照，完整保留 trial.json、test-delivery-config.json、durable、issues、deliveries、archive-manifests 等状态。不要仅复制 SQLite。
2. 使用该快照对应的引擎和有权读取私有 artifacts 的 GitHub CLI，在临时副本上执行 `GITHUB_REPOSITORY=nowscott/EverydayTechNews-data node packages/news-engine/src/main.ts restore-artifact --data <快照目录>`。下载全部未到期正文证据，保留原哈希与有效期。
3. 检查所有未过期 objects 的 transient 文件存在且 SHA-256 匹配。若缺失，先解决下载问题，不能启用 NAS 模型或发送。
4. 验证后，仅在交接副本中将 archive-manifests/latest.json 和 days.json 移到交接备份中；保留 objects.json。NAS 启动器遇到 latest.json 会拒绝启动，避免误调用 GitHub 下载。原仓库和原 artifacts 不动。
5. 将完整交接副本（包括 transient）传入新的 data 目录，排除 .git、旧锁文件和可重建的 state.sqlite3。修正所有者权限，运行 status、report，并对照迁移前的费用、发送记录、期刊、未确认外部动作和正文数量。不要重置账本或重新 init。
6. 将既有测试密钥填入 .env，确认只发 nowscott@qq.com；保持每日最高2元；七天试刊是历史迁移设置。2026-10-23用户已授权长期内部测试，按下方连续测试流程启用。
7. 对照成功后设置 NAS_TRIAL_ENABLED=true，再执行 run。这个开关不会修改或放宽 trial.json 内的开关、收件人和期限。

NAS 的正式 run 还使用 `--local-authority`，仅在 Linux flock 保护下运行。私有数据目录必须为 0700，且包含 0600 的 `.nas-authority.json`，记录旧任务已停止、来源提交和原状态摘要；缺少交接记录会拒绝真实模型和 SMTP 操作。普通离线副本不获得此权限。该模式每次外部操作前以 fsync 的原子状态检查点持久化费用预留与发送记录，无需 GitHub 凭据。

## 定时运行

NAS 后续已由用户调整为 `192.168.31.10` 并接管家庭网络；当前新闻容器使用 OpenSurge 回环端口 7890。这里仅跟随现有代理，不调整家庭网络。早期代理交接历史见 [交接记录](OPENSURGE-20261019.md)，最终内测接管状态见 [运行记录](NAS-LIVE-20261019.md)。新闻容器需叠加 `compose.proxy.yaml` 才会使用它：

```sh
docker compose --env-file deploy/nas/.env -f deploy/nas/compose.yaml -f deploy/nas/compose.proxy.yaml run --rm premium maintenance
```

代理模式的正式定时命令同样要加上第二个 `-f deploy/nas/compose.proxy.yaml`。该文件启用主机网络，使用 NAS 回环地址的 HTTP 代理与 Node 原生环境代理支持，不发布服务端口。代理独立于 Mac；没有代理服务的其他机器不要套用这个覆盖配置。

NAS 使用 `NEWS_COLLECTION_PROFILE=nas_balanced`：日间约每 30 分钟采集，04:00–06:15 约每 15 分钟采集，06:15–09:00 暂停采集并维持原冻结/发送窗口。以时间桶判断到期，避免任务启动秒数抖动导致漏过一次采集。来源返回 429 后单独冷却 1 小时，跳过期间不顺延冷却终点。

用户 crontab 日间在 07/37 分唤起，04–08 点在 07/22/37/52 分唤起；晨间长任务仍由宿主锁避免重叠。运行入口：

```sh
/bin/sh /vol3/1000/Docker/everydaytechnews-test-20261019/deploy/nas/run-scheduled.sh
```

晨间 run 内部有等待循环，不能设置过短的计划任务超时；建议允许至少 6 小时。数据目录内 Linux flock 会串行保护账本。宿主调度也应禁止同一个任务重叠运行，防止长任务积压；不能仅依赖数据库锁。NAS 的时钟需正常同步。

未启用前定时任务可使用 maintenance。不要使用 compose up 常驻：这里是一次性任务容器，正常退出不代表邮件已送达，应查 report 和 deliveries；SMTP accepted 也只代表 SMTP 接收。

## 存储、更新与恢复

data 是完整持久状态，更新容器不会移除它；正文仍按现有对象有效期清理。每次 run 最后重新生成 .cache/evidence.tar.gz；不要每天复制整包永久保留，否则会延长旧正文的保留期。需对 NAS 快照与备份配置相同的敏感内容到期规则。

更新前暂停计划任务并等当前任务退出，备份状态，取得指定的已验证代码版本，重新 build，再运行 status/report，最后恢复调度。不要自动追 main。首次版本和后续版本的提交号应记录在交接记录中。

故障回滚只回滚代码；保留更新后新增的费用和发送账本。若状态结构变更，需专门迁移方案。不要恢复旧备份后直接再次运行发送。切回 Actions 也必须先停 NAS、回传最新账本与正文，并重新建立其归档指针。

## 验证边界

容器使用官方 Node 24 Debian 镜像，安装 flock，不安装 GitHub CLI，也不传入 GH_TOKEN。无发布端口，不需要 Docker socket。密钥和运行数据不进入镜像构建上下文。

本地未安装 Docker，镜像在飞牛上构建。2026-10-19 的实机验证与未完成项见 [DEPLOYMENT-20261019.md](DEPLOYMENT-20261019.md)。不能将容器启动成功等同于完整来源采集、模型生成或投递成功。

## 正式版本管理

后续更新采用 [Git Release、自动部署与回退流程](VERSIONING.md)。`local` 镜像仅用于最初迁移；受管理运行使用固定提交和镜像摘要，每 15 分钟检查正式版本，04:00–09:00 不切换，失败继续使用旧版。


## 长期内部测试（2026-10-23用户授权）

news-engine-v0.6.0起支持显式`testing_period=continuous`，`days=null`、`expires_at=null`。仅取消整轮测试到期日；仍只发指定测试邮箱，每日2元、100个新版本、05:00—06:12新增模型请求、06:30—09:00投递、AI验收与生产关闭均保留。人工样刊许可仍最长30分钟，到期不重开；未知费用/SMTP状态不重试。

先按VERSIONING发布并部署0.6.0，在NAS从该正式版本源码执行`python3 deploy/nas/enable-continuous.py --root /vol3/1000/Docker/everydaytechnews-managed`。工具锁定更新、调度与账本，备份原trial.json，只修改测试期限，使用实际镜像离线验证，并证明费用/冻结期刊/投递账本不变。旧版不能读取新配置时回退会被阻断，不得恢复旧账本；后续修复发布兼容版本。

价格策略使用`verification_mode=live_every_request`与`valid_until=null`，含义是每次付费请求都须重新核对官方模型版本、价格表和时段规则，并非永久信任当前价格。无法读取或规则改变即暂停该次请求。暂停长期测试仍使用现有enabled/model_enabled/delivery_enabled开关。


## NAS自主异常检查（v0.6.1）

随身电脑上的Codex每日评分和普通版迁移复核已按用户2026-10-23要求暂停。NAS继续独立采集、AI逐篇/整期验收、发送与生成报告。人工编辑评分按需复盘，不把模型验收率换算成85分。

从正式版本源码执行`python3 deploy/nas/health-check.py --root /vol3/1000/Docker/everydaytechnews-managed install`安装独立NAS任务，09:10—23:10每小时检查一次。正常不发通知；未见当日SMTP接收、未知发送/费用、预算异常或全部来源失败时，仅通知指定测试邮箱。已投递的不足15条诊断不重复通知。通知结果未知不会自动重发，同一天最多一次；网络或SMTP不可用时只能保留本地记录，不能保证通知送达。检查本身不调用模型、不补发早报、不修改费用或早报发送账本。普通版自身已有NAS异常通知。

普通版迁移仍处影子观察，正式切换需在NAS可访问时完成一次验收及凭据配置；暂停本机复核不会提前放行。


## Notion 统一管理高级版收件人（v0.6.2）

在原订阅数据源增加复选框 `高级内测`。内测收件条件为：记录未归档、`状态=正常`、有效 `Email`、`高级订阅=true` 且 `高级内测=true`。包括管理员在内均须勾选，不使用代码里的邮箱名单；缺少字段或 Notion 查询失败时停止投递。原 test-delivery-config.json 仅保留历史运行授权边界，不再作为收件名单。

每个邮箱独立投递、指纹及发送记录；已接收或结果不明的记录不重发。新加入的测试邮箱从下一期定时出刊起生效，不补发历史期刊。运维异常通知仍只发原管理员。正式高级订阅使用同一数据源的 `高级订阅` 字段，结束测试仅需清除 `高级内测`，保留高级订阅与正常状态；正式群发仍须单独启用。

## 高级内测收件人备份

NAS 在 06:00–06:15 的首次晨间运行刷新内测收件人备份，并在发信前再次读取 Notion。网络错误、429 和 5xx 最多尝试三次，仍不可用时使用不超过七天的备份；缺失、损坏、过期或配置与权限错误会阻止发送。备份保存在私有 data/subscriber-backups，不进入证据归档；晨间报告只显示来源、时间、人数和错误原因。旧备份无法体现之后的退订与新增。

首次部署后，使用管理目录当前版本的 compose 配置运行 premium 服务的 `sync-subscribers`，仅同步名单，不发送邮件。查看 data/subscriber-backups/premium-report.json 中的来源和时间，确认首次备份成功。
