# 更新日志

## news-engine-v0.7.0 / nas-dashboard-v1.4.1

- 修复写稿入口遗漏的旧固定到期检查，持续内测遵从现有配置期限；不延长有期限内测，不放宽调用窗口或预算。

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
- Exercise managed container startup in CI and support explicit, checked controller upgrades with backups.
