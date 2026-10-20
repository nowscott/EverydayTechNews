# 普通版 NAS / TypeScript 迁移

普通版使用 Node 24，采集、IT之家评分排序、最多25条标题链接、普通邮件版式、Notion正常订阅与45天退订链接保持兼容。高级版独立运行；普通版不调用模型，也不继承高级版的试刊期限、来源配额或测试邮箱限制。Python仅用于发布控制与离线对照。

## 发布与首次部署

普通版组件标签为 `ordinary-news-vX.Y.Z`，独立于原项目v2.x和高级引擎news-engine版本。源码经PR、main上ordinary-news.yml及相关回归检查后，创建正式非预发布Release，保持`--latest=false`。NAS只部署通过main检查、固定提交与镜像摘要的版本。

运行目录：`/vol3/1000/Docker/everydaytechnews-ordinary`。其中data为0700私有状态，managed为独立控制器/版本/备份，ordinary.env仅供普通业务容器，archive.env仅供归档发布器，权限均为0600。ordinary.env需要既有SMTP、Notion、APP_BASE_URL及与订阅网站一致的SUBSCRIPTION_CONFIRMATION_SECRET，另设置：

```
ORDINARY_DELIVERY_ENABLED=true
ORDINARY_PRODUCTION_ENABLED=false
PREMIUM_PRODUCTION_ENABLED=false
```

这些开关不启用正式群发，初始配置始终为shadow，仅允许nowscott@qq.com，第一天为安装后的下一自然日。不得填写、修改或复制高级版试刊配置。

从正式标签的已验证源码运行：

```sh
python3 deploy/ordinary/install-managed.py --root /vol3/1000/Docker/everydaytechnews-ordinary --tag ordinary-news-v1.0.2
```

安装器保留现有crontab，并新增独立每分钟运行、每15分钟更新、每30分钟异步归档任务。原普通版三个Actions工作流继续运行；高级版控制器不替换。初始化、部署校验无网络/无密钥，不发送邮件。首次使用独立容器执行preflight.ts，仅验证Notion读取、SMTP登录和过期退订token签名，不发信、不修改订阅状态。

## 运行与状态

- 每两小时07分采集，00:30起排序昨日文件，06:15冻结当期内容，06:30发送；任务晚到可恢复至09:00，09:00起不发起投递。以实际时钟复核，进程退出或重启不会重置账本。
- 群发单连接、逐收件人处理，SQLite FULL同步事务在连接前认领，关闭邮件库自动重新入队。记录SMTP DATA边界，提交后断线或中断一律未知，不自动重发。明确提交前临时失败最多3次。
- 每轮恢复刷新订阅资格，不再向已退订者继续发送。确认永久RCPT拒绝才进入Notion异常状态outbox，更新前重读状态，不覆盖退订/待确认。
- 公开新闻归档与私人订阅数据分离。发布器只挂载只读公共归档快照、只读发布配置与同步状态，不挂载SMTP/Notion环境或订阅数据库。GitHub不可用不阻断出刊，冲突不强推、不覆盖人工修改。
- 每日报告在data/reports/YYYY-MM-DD.json；仅报告数量和状态，不输出收件地址。09:05后异常通知指定管理邮箱；邮件通知结果未知时保留状态，不冒充送达。

## 三天观察与正式切换

1. 连续三个真实晨间运行，只向测试邮箱发一封标记测试邮件；正常网络下06:31前开始、06:35前结束，无未知或重复发送。
2. 在操作电脑运行 `python deploy/ordinary/verify-shadow.py --date YYYY-MM-DD`，用同一批采集和投票证据与旧Python算法逐项离线比较，结果写入私有shadow报告。历史七日离线对照不替代这三天实际定时观察。
3. 用户至少确认一次普通版TS测试邮件确实收到，才记录data/feedback/YYYY-MM-DD.json，格式为status=received_confirmed、confirmed_by=user、confirmed_at与依据；SMTP成功不能代替。
4. 在NAS的archive.env配置仓库专用细粒度凭据`ARCHIVE_GITHUB_TOKEN`，仅当前仓库Contents读写，不授予Actions/Workflows/管理权限，不使用个人全局CLI登录token。值不要提交Git或发到聊天。
5. 在操作电脑运行 `python deploy/ordinary/cutover.py` 检查，或加`--apply`执行已授权的切换。工具只在09:00之后工作，先检查三天报告和凭据写权限，设置仓库级ORDINARY_NAS_PRODUCTION_ENABLED=true防止手动重启形成双发送者，再停旧采集、排序、发信工作流并等待运行结束；导入最终公共归档快照，备份私有配置，将下一自然日设为首个正式出刊日。旧日不补发，测试账本不计入正式发送。

原工作流名：technews.yml、news-sorter.yml、run-selenium-script.yml。shadow期间不禁用；归档发布器正式运行时也核对它们已停用。切换失败不盲目重新启用旧Python发送，以免双端发信；修复后从切换记录继续。

更新/回退复用Python部署器的验证、状态备份与固定版本规则，普通版通过SQLite backup API复制WAL状态。回退只换代码，保留最新账本；没有兼容版本时暂停并修复，不恢复旧数据库或直接重启旧Python群发。控制器自身固定复制，升级必须单独安装，不随普通Release静默替换。

## 验证

运行普通版类型检查与Node测试、全部Python回归、高级版回归、两组部署测试，以及普通版Docker冷启动和离线状态校验。覆盖至少7日历史归档、过滤/排序/模板兼容、100人模拟投递、真实本地SMTP DATA断线、未知结果、订阅变化、截止时间、归档冲突及三天切换门槛。测试与preflight不能记为正式出刊或收件箱成功。

日常NAS运行不依赖Mac。操作电脑上的对照验收和当前聊天的后续复核允许补查历史证据；电脑未在线会延后验收/切换，旧系统继续服务。不得以观察期结束或CI绿色代替三次正常出刊和实际收件确认。

账本校验使用逐行摘要，避免随着历史邮件增长一次性把全部内容载入内存；1.0.2在64MB JavaScript堆限制下验证大型账本。
