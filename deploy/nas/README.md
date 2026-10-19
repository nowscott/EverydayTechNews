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
6. 将既有测试密钥填入 .env，确认只发 nowscott@qq.com；保持原每日最高 2 元和 2026-10-26 00:00 上海时间到期边界。迁移不重开七天试刊。
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
