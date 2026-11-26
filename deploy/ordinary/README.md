# 普通版 NAS / TypeScript 迁移

普通版使用 Node 24，采集、IT之家评分排序、最多25条标题链接、普通邮件版式、Notion正常订阅与45天退订链接保持兼容。高级版独立运行；普通版不调用模型，也不继承高级版的试刊期限、来源配额或测试邮箱限制。控制器、安装器与看板记录器均为 TypeScript，仓库不再包含 Python 实现。

## 发布与首次部署

普通版组件标签为 `ordinary-news-vX.Y.Z`，独立于原项目v2.x和高级引擎news-engine版本。版本源、Docker 镜像 tag 与 GitHub Release 必须使用同一个编号，规则见[版本号口径](../../VERSIONING.md)。源码经PR、main上ordinary-news.yml及相关回归检查后，创建正式非预发布Release，保持`--latest=false`。NAS只部署通过main检查、固定提交与镜像摘要的版本。

OpenWrt 代理、归档发布和控制器私有配置及升级顺序见 [OpenWrt 迁移](../nas/OPENWRT-MIGRATION.md)。

运行目录：`/vol3/1000/Docker/everydaytechnews-ordinary`。其中data为0700私有状态，managed为独立控制器/版本/备份，ordinary.env仅供普通业务容器，archive.env仅供归档发布器，权限均为0600。ordinary.env需要既有SMTP、Notion、APP_BASE_URL及与订阅网站一致的SUBSCRIPTION_CONFIRMATION_SECRET，另设置：

```
ORDINARY_DELIVERY_ENABLED=true
ORDINARY_PRODUCTION_ENABLED=false
PREMIUM_PRODUCTION_ENABLED=false
```

这些开关不启用正式群发，初始配置始终为shadow，仅允许nowscott@qq.com，第一天为安装后的下一自然日。不得填写、修改或复制高级版试刊配置。

从正式标签的已验证源码运行：

```sh
node deploy/ordinary/install-managed.ts --root /vol3/1000/Docker/everydaytechnews-ordinary --tag ordinary-news-v1.0.4
```

安装器保留现有crontab，并新增：每小时 :17 检查正式 Release、每天 06:40/08:40/12:40/20:40 异步归档、每 10 分钟一次 `scheduler-up` 看门狗。出刊时间表（05–09 点每 2 分钟、其余时段 :07/:37）由镜像内常驻调度 `scheduler.ts` 执行（compose 服务 `scheduler`，容器 `etn-ordinary-scheduler`），不再进 crontab。原普通版三个Actions工作流在切换前继续运行；高级版控制器不替换。初始化、部署校验无网络/无密钥，不发送邮件。首次使用独立容器执行preflight.ts，仅验证Notion读取、SMTP登录和过期退订token签名，不发信、不修改订阅状态。

## 运行与状态

- 每两小时07分采集，00:30起排序昨日文件，06:15冻结当期内容，06:30发送；任务晚到可恢复至09:00，09:00起不发起投递。以实际时钟复核，进程退出或重启不会重置账本。
- 群发逐收件人处理，每条 SMTP 连接最多发送10封后主动更换；SQLite FULL同步事务在连接前认领，关闭邮件库自动重新入队。记录SMTP DATA边界，提交后断线或中断一律未知，不自动重发。明确提交前临时失败最多3次；连接或发件人阶段失败时暂停当前轮次，后续收件人保留待处理。
- 每轮恢复刷新订阅资格，不再向已退订者继续发送。连续三次永久RCPT拒绝才进入Notion异常状态outbox，更新前重读状态，不覆盖退订/待确认。
- 公开新闻归档与私人订阅数据分离。发布器只挂载只读公共归档快照、只读发布配置与同步状态，不挂载SMTP/Notion环境或订阅数据库。GitHub不可用不阻断出刊，冲突不强推、不覆盖人工修改。
- 每日报告在data/reports/YYYY-MM-DD.json；仅报告数量和状态，不输出收件地址。09:05后异常通知指定管理邮箱；邮件通知结果未知时保留状态，不冒充送达。

## 三天观察与正式切换

1. 连续三个真实晨间运行，只向测试邮箱发一封标记测试邮件；正常网络下06:31前开始、06:35前结束，无未知或重复发送，且每天有有效投票评分；评分全失败的降级日不能通过迁移观察。
2. 三天的采集与投票证据保存到私有 shadow 报告（`data/reports/`），与冻结的对照快照逐项核对；历史离线对照不替代这三天实际定时观察。原 `verify-shadow.py` 已随 Python 撤除。
3. 用户至少确认一次普通版TS测试邮件确实收到，才记录data/feedback/YYYY-MM-DD.json，格式为status=received_confirmed、confirmed_by=user、confirmed_at与依据；SMTP成功不能代替。
4. 在NAS的archive.env配置仓库专用细粒度凭据`ARCHIVE_GITHUB_TOKEN`，仅当前仓库Contents读写，不授予Actions/Workflows/管理权限，不使用个人全局CLI登录token。值不要提交Git或发到聊天。
5. 切换在 09:00 之后人工执行：先核对三天报告与凭据写权限，设置仓库级 `ORDINARY_NAS_PRODUCTION_ENABLED=true` 防止手动重启形成双发送者，再停旧工作流并等待运行结束；导入最终公共归档快照，备份私有配置，将下一自然日设为首个正式出刊日。旧日不补发，测试账本不计入正式发送。原 `cutover.py` 一键切换工具已随 Python 撤除。

原工作流 technews.yml、news-sorter.yml、run-selenium-script.yml 已随 Python 撤除，GitHub 侧不再有旧发送/排序/抓取回退通道；出刊只由 NAS 常驻调度执行。切换失败不得手工重发，修复后从切换记录继续。

控制器自 2.7.6 起为 TypeScript：`deploy/ordinary/manage.ts` + `deploy/nas/base-manage.ts`，宿主机 Node 固定运行时为 `/vol3/1000/Docker/everydaytechnews-runtime/bin/node`（升级用 `deploy/nas/runtime.ts`：`status` / `install <版本> [--check]` / `rollback`，校验 SHASUMS256 与解压后版本号，原子切换并保留旧目录）（cron 以 `--disable-warning=ExperimentalWarning` 调用）。`status` 输出与账本哈希口径由冻结的对照快照守住（`packages/ordinary-news/test/controller-ledger.test.ts`）。
更新/回退复用同一套验证、状态备份与固定版本规则，普通版通过 SQLite `VACUUM INTO` 复制 WAL 状态。回退只换代码，保留最新账本；没有兼容版本时暂停并修复，不恢复旧数据库或直接重启旧版群发。控制器只有 `.ts` 一份，升级必须单独安装，不随普通 Release 静默替换。

## 验证

运行普通版类型检查与 Node 测试、高级版回归，以及普通版 Docker 冷启动和离线状态校验（镜像内断言不存在 python 解释器）。覆盖至少7日历史归档、过滤/排序/模板兼容、100人模拟投递、真实本地SMTP DATA断线、未知结果、订阅变化、截止时间、归档冲突及三天切换门槛。测试与preflight不能记为正式出刊或收件箱成功。

日常NAS运行不依赖Mac。操作电脑上的对照验收和当前聊天的后续复核允许补查历史证据；电脑未在线会延后验收/切换，旧系统继续服务。不得以观察期结束或CI绿色代替三次正常出刊和实际收件确认。

账本校验使用逐行摘要，避免随着历史邮件增长一次性把全部内容载入内存；1.0.2在64MB JavaScript堆限制下验证大型账本。

## 手动样刊测试

不触发采集或排序、不写账本、不占用 06:30—09:00 投递窗口，只读 `news_archive` 最新一期渲染一封样刊，收件人写死为测试邮箱：

```sh
ORDINARY_SMOKE_DRY=1 node packages/ordinary-news/src/main.ts smoke-send --data .
ORDINARY_SMOKE_SEND=YES SENDING_ACCOUNT=… SENDING_PASSWORD=… SERVER=… \
  APP_BASE_URL=https://mailist.nowscott.top SUBSCRIPTION_CONFIRMATION_SECRET=… \
  node packages/ordinary-news/src/main.ts smoke-send --data .
```

GitHub 侧用「普通版手动样刊测试（TS）」工作流：`confirm` 留空只渲染并输出条数与字节数，填 `SEND` 才真的发信。任何输入都不能把收件人改成其他人。

## 收件人备份

NAS 普通版在 06:00–06:15 首次运行时刷新一次私人收件人备份，发信前再查询 Notion。网络错误、429 和 5xx 最多尝试三次，仍不可用时使用不超过七天的备份；缺失、损坏、过期或配置与权限错误会阻止发送。报表只显示来源、时间、人数和错误原因。备份仅在私有 data 目录内，可能不包含同步之后的退订或新订阅。

部署此功能后，在 NAS 用当前管理目录的 compose 配置，执行 ordinary 服务的 `sync-subscribers --data /data`，仅同步名单，不发送邮件；检查报告中的来源与时间。普通版处于 shadow 时，正式群发仍由 GitHub Actions 执行，其运行环境无法读取 NAS 本地备份；只有完成既定迁移并切换至 NAS 正式模式后，普通版正式群发才具备此回退能力。
