> 当前高级版已于2026-10-23获用户授权改为长期内部测试，TS引擎v0.6.0起生效，仍限定测试邮箱和每日2元。部署和期限配置以deploy/nas/README.md为准。以下七天试刊说明及Python命令为历史参考，不是当前长期任务入口。价格策略现在每次请求实时核验，不使用旧固定有效期。

# 持久化多来源科技早报（内部实验）

高级订阅TS运行入口及私有部署状态见 [TS引擎说明](../../packages/news-engine/README.md) 与 [迁移记录](../../packages/news-engine/MIGRATION.md)。下文Python命令保留为原实现参考；上线后的高级订阅工作流使用TS，不执行Python。原入口是pool.py。旧说明保留在 [LEGACY_EXPERIMENT.md](LEGACY_EXPERIMENT.md)，其中8条上限、旧调度和work命令已经被替代。普通订阅、真实名单、网页、支付未改变。

## 内容及状态

目标15～20条：5条重点（通常80～150字）＋10～15条短讯（通常50～80字）。同次DeepSeek请求生成地道中文标题、长短概括、最多3条互补要点、可选关注理由、原文连续证据及不确定项；简单信息可更短，不编造背景。原文是不可信输入，不能改变规则或调用工具。通过结构及证据子串校验仍不代表事实保证，初稿全部待人工逐条审阅。

AI、Apple、NVIDIA、Tesla、SpaceX同级加12分，同篇只取最高兴趣加分。基础评分覆盖科技相关性、重要性、时效、证据量、来源接近程度及营销惩罚；覆盖芯片、开发软件、安全、机器人、汽车、商业航天等。来源不设数量硬上限；领域统一8类，每期同领域最多4条、前5条重点同领域最多2条，品牌仍为兴趣标签。近分多样性排序继续保留。普通版和高级版共用关键词及价格标题排除规则，见config/news-filter.json。配置在editorial.json，保留评分配置及版本。

文章独立采集、评分、排队、生成和待审；到时间才从完成池组稿。重评分不重采集，重排版不调用模型。缓存包含内容、模型、提示词与输出规范版本。仅草稿不消耗文章，SMTP接受后才防止重复选用。共享品牌/产品不等于同事件；更新需在durable/update-approvals/<指纹>.json记录人工确认的新增事实，不把字节变化自动当成新事实。批准记录必须含fingerprint、reviewed_by、reviewed_at，以及new_facts数组（fact及当前正文逐字evidence）；空文件不能批准更新。

不足15条时保留草稿，发送异常诊断，列出采集、正文、时效、去重、评分、AI状态和预算的排除原因。补处理只在截止前从有限高分队列进行，不放宽证据和时效凑数。

## 私有持久化与90天正文

数据仓库：nowscott/EverydayTechNews-data（PRIVATE）。公开项目只放代码、测试、模板及文档。

- durable/state.json保存权威版本元数据、观察记录、任务、调用预算预留、usage、AI结果及关键证据；SQLite可删除后重建。
- issues/<期号>/长期留存edition.json、HTML、纯文本、脱敏comparison.json、ranking.json、人工审阅CSV；冻结后不覆盖。
- 原始RSS/API、清洗全文、模型原始响应、全文对照放transient，按捕获日期分私有Actions artifact日桶，retention-days=90。日桶只保留最新成功版本，避免滚动全集让旧全文留存180天。对象清单记录捕获时间、哈希、字节数及到期时间；到期/缺失不再用于生成。GitHub保留按日计量，不是精确到秒的删除承诺。
- 全文不进入Git历史。旧数据迁移用一次性私有Release资产桥接，成功上传artifact并保存指针后立即删除Release及标签；失败须及时恢复或人工删除，不将桥接作为永久归档。
- 每次恢复私有日桶后重建索引，下载失败阻断后续处理。外部调用前先提交并推送认领和预算，失败立即停止；调用后也保存。冲突不自动重放外部动作，inflight/不确定结果不会自动再付费或重发。
- status.json记录归档逻辑字节数；GitHub实际存储、额度及费用另查账户Billing。没有承诺免费或无限容量。

## 来源与使用条件

保留IT之家、NVIDIA、GitHub、Cloudflare、Microsoft Foundry。OpenAI/Google短摘要、HN、Bloomberg主要用于发现；未取得足够原始正文就不精编。HN投稿时间不当作文章时间，不抓评论，不绕过Bloomberg付费墙。

| 新来源 | 实际适配及局限 | 条件核查（2026-10-18） |
|---|---|---|
| Apple Newsroom | 官方Atom可访问，多为短摘要、仅updated。仅在允许的同站正文取得带时区原始发布时间后才升级为可用正文。 | [Apple条款](https://www.apple.com/legal/internet-services/terms/site.html)对复制、自动访问和用途设限；RSS不等于模型/商业分发许可，四类用途均未获明确确认。 |
| Tesla IR | 轻量官方公告适配；猜测RSS为404，不采用。当前本地公告页403，记录缺口，不绕过；公告数量稀疏。 | [Tesla法律信息](https://www.tesla.com/about/legal)及IR具体适用条款待核实；保存、模型处理、摘要及邮件分发未确认。 |
| NASA | 官方RSS包含正文和pubDate，用于航天、部分NASA/SpaceX合作任务，不代表完整SpaceX覆盖。 | [NASA媒体指南](https://www.nasa.gov/nasa-brand-center/images-and-media/)有第三方材料、标志、背书等例外；本实验无图片，不推定所有文字及第三方材料获授权。 |
| SpaceX | 官方更新页当前受阻，尚无已验证直接官方RSS/API。 | 使用条件未确认，明确显示缺口。 |

其他来源条件见LEGACY_EXPERIMENT.md。未确认权限记为unconfirmed；内部样本不代表已获商用授权。

## 本地操作

```sh
.venv/bin/python experiments/premium/pool.py init
.venv/bin/python experiments/premium/pool.py import-legacy --legacy premium_data
.venv/bin/python experiments/premium/pool.py collect
.venv/bin/python experiments/premium/pool.py assess
.venv/bin/python experiments/premium/pool.py enrich
.venv/bin/python experiments/premium/pool.py compose
.venv/bin/python experiments/premium/pool.py deliver
.venv/bin/python experiments/premium/pool.py report
.venv/bin/python experiments/premium/pool.py preview-legacy
```

默认premium_data/pool。init创建禁用配置，不覆盖已有试验；导入只允许空目标。旧20篇及36调用保留历史身份，不计七天、不重新付费。旧brief.py work停用，防止独立旧账本付费；run_trial.py改为新池的本地包装入口。

preview-legacy将旧真实结果重排为5条重点＋15条短讯，短讯仅选择历史模型已生成的完整要点，记录程序选择。这不是新版双长度真实API验证，不进入新版本完成池。邮件在issues/sample-2026-10-18-pool-preview/email.html；全文对照在transient/reviews/同名期号/review.html。

密钥仅从环境DEEPSEEK_API_KEY读取，不接受命令参数或聊天密钥写入文件。deliver才需要SENDING_ACCOUNT、SENDING_PASSWORD、SERVER；新池不加载普通版.env或Notion。

## Actions、七天试刊与启停

private-workflow.yml.template只是模板，不在公开仓库调度。prepare_private.py --engine-ref <已推送的完整40位SHA>准备禁用的私有仓库；引擎固定SHA，不追随main。

统一并发组premium-private-state。每小时:15/:45检查采集到期、:25/:55唤醒生成；UTC22:05/10=上海06:05/10补处理；22:15=06:15组稿，22:30/45=06:30/45投递恢复，23:00=07:00检查延迟。05:55额外尝试采集。执行时按真实上海时间判定，不能把计划发起时间当实际时间。

上海06:00固定采集截止，06:15冻结，06:30目标发送，07:00起不自动补发。晚到内容留后续池，下期仍检查时效。GitHub可能排队，不承诺准点。

trial.json默认enabled/model_enabled/delivery_enabled/production_enabled全部false。仅支持internal_test、7天、唯一收件人nowscott@qq.com。启用时把start设为下一个完整上海日期，expires_at为start+7天00:00，并复核价格有效期。七天到期停止新增付费和投递，维护继续。

私有Secrets：DEEPSEEK_API_KEY、PREMIUM_SMTP_ACCOUNT、PREMIUM_SMTP_PASSWORD、PREMIUM_SMTP_SERVER。通过Secrets页面或隐藏输入设置，不打印值。手动工作流默认maintenance_only=true，允许在总开关关闭时测试恢复、采集和归档，绝不调用模型或SMTP。

- 开启仅维护/采集：仓库变量PREMIUM_ENABLED=true，trial模型和发送仍false。
- 开始七天：先确认Secrets、日期和规则，再显式打开trial.enabled/model_enabled/delivery_enabled。邮件标注【测试】及未经逐条人工事实审阅。没有生产启用入口。
- 停止生成或投递：关闭trial对应开关。关闭PREMIUM_ENABLED会同时停维护，须先处理临时迁移Release及归档清理。不要删任务/账本来“重置失败”。

## 统一门禁与费用

paid_request是唯一模型POST；写作、翻译、已知费用修复都走同处。试验任意时段授权必须来自有限期trial；默认生产门禁05:00～06:15，06:12起不收新请求，客户端总deadline90秒。每次请求重新核对官方规则、模型价格、有效期、配置、时间、缓存及预算；远端预留保存后再次检查时间。客户端不能保证服务端实际计费时间。

[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)于2026-10-18再次实取：deepseek-flash / DeepSeek-V4.1-Flash-1017，空闲每百万输入未命中1元、命中0.02元、输出4元；工作日09:00～12:00、14:00～18:00为高峰，法定节假日除外，价格翻倍。测试保守预留，不推测节假日折扣。policy有效期至2026-10-26 00:00；规则无法确认、变化或过期暂停。不升级更贵模型、不使用Search/Fetch。

每条假设4000输入＋1000输出，无缓存：20条约0.16元，32候选约0.256元，高峰翻倍；全部三次尝试约1.536元。正文长度和修复会改变实际费用，每日默认2元预留上限，七天14元。SMTP、Actions、存储费用另计，不是固定包价。

记录实际token、调用次数、耗时和估算，未知用量保留预算；估算不等于账单实付。超时、中断、传输不确定不自动重试；429退避仍受门禁。SMTP accepted不是QQ收件证明。

## 验证边界

采集性能实验见[PERFORMANCE.md](PERFORMANCE.md)：默认最多4源并发，主线程统一落库，`collect --collect-workers 1`可退回串行；source-health记录墙钟、CPU和来源耗时。提供只采集的串并测速入口，不调用模型、不发送邮件、不操作正式池。

运行 `.venv/bin/python -m unittest discover -s tests -v`。覆盖普通流程及窗口/换日、预算、超时/格式、缓存、双长度、等权兴趣、来源软多样性、状态恢复、过期、持久化失败、截止、诊断、唯一收件人、重复投递、七天到期。

历史20篇真实结果、新版双长度API、人工事实审阅、QQ收件及七天运行分别报告；不把离线通过或一次样稿称为可收费标准。缺少环境密钥就完成来源和归档验证，不伪造新的API调用。

## 单篇真实API验收

私有手动工作流选择maintenance_only=false、verify_api=true，可在试刊开始前做单篇验收；同样经过唯一paid_request、远端预算预留、实时官方规则核对及测试时段授权。首次执行固定文章和30分钟有效期，重复执行不延长授权、不换文章，完成结果复用；已知费用格式修复总尝试不超过3次，未知费用不重试。结果在durable/api-verification.json，不发邮件、不计七天。maintenance_only=true始终不调用模型。

滚动写作按下一期06:00截止倒推24小时，避免在午夜把每天100个新文章版本名额花在到早报时已过期的新闻；06:00～06:15的补处理只使用当天06:00之前已获取的版本。

## 当前24小时新选题样稿（2026-10-18反馈后）

刚发送的pool-preview为历史20篇重排，不能代表新偏好选题。新增fresh-sample手动入口：冻结当前24小时全部合格候选（每日最多100个新文章版本，已有缓存不占新名额）、30分钟生成截止，先复用双长度结果，再经统一付费入口精编至最多20条；失败保留，可按原冻结输入恢复。少于15条不发正常样稿。它独立于每日06:00截止的七天试刊，不计完成天数。工作流maintenance_only=false、fresh_sample=true会生成并仅向指定测试邮箱发送，主题标注“新版选题”；定时任务不会触发此入口。

补充已探测来源：MacRumors官方全文RSS（description较完整，带时区pubDate）；Apple Developer官方RSS（description有可用公告正文，pubDate含PDT）；NASA任务博客（content:encoded）；Ars Technica科学RSS（content:encoded，仅可用摘录，不宣称完整原文）。9to5Mac/Electrek RSS显式more…截断，未接入生成；Spaceflight Now/NASASpaceflight403，不绕过；SpaceNews当前短摘要不足，未接入生成。SpaceX不足时明确显示缺口，不拿旧新闻凑齐兴趣。

MacRumors的[RSS说明](https://macrumors.zendesk.com/hc/en-us/articles/201096058-Where-are-the-RSS-feeds)与[注册/版权条款](https://macrumors.zendesk.com/hc/en-us/articles/201146626-MacRumors-Registration-Agreement)不能视为第三方模型或商业分发授权；Apple/NASA仍适用前述条件；Ars站点版权和具体适用协议仍待进一步核实。四类用途均保持unconfirmed，不使用图片、不购买付费服务。

新格式每日100个新文章版本上限只统计dual-1任务（未知归属任务按新格式保守计入）；当天迁移的旧版20篇仍完整计入人民币2元费用预算，不通过迁移清空账单。相近3分内的多样性排序同时考虑来源、主题与兴趣重复，品牌加分不叠加、不强制分配名额。
