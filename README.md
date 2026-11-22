# EverydayTechNews(每日科技新闻)

每天早晨自动发送科技新闻到你的邮箱。

点击[这里](https://mailist.nowscott.top/)订阅每日科技早报

[![Star History Chart](https://api.star-history.com/svg?repos=nowscott/EverydayTechNews&type=Date)](https://star-history.com/#nowscott/EverydayTechNews&Date)

[![forks][forks-image]][forks-url]

[forks-url]:https://github.com/NowScott/EverydayTechNews/forks
[forks-image]:https://img.shields.io/github/forks/NowScott/EverydayTechNews?label=Forks

> 正式出刊由 NAS 自主调度，不依赖 GitHub Actions 的定时触发；工作流仅保留测试与构建校验。原因与迁移过程见[架构说明](#架构nas-自主调度已脱离-github-actions定时)。

## 创建初衷

小时候，家中的长辈常订阅报纸。然而，随着时代的变迁，报纸逐渐退出我们的视野，被无处不在的互联网新闻取而代之。

在这个广袤的信息海洋中，琳琅满目且杂乱无章，包含了大量的信息。但实际上，我对于关注的内容并不多。

因此，我创建了这个工具，每天自动将科技新闻发送到我的邮箱。

这样，我就不再淹没在大量信息中，而是像过去阅读报纸时一样，只专注阅读我最感兴趣的部分。

## 工具介绍

因为不想暴露我的个人邮箱，所以真正每天在运行的工具在另外一个私有库中，本项目的目的在于帮助同样有这个需求的朋友们搭建这样一个小工具。

当前主线已经迁移到 TypeScript（Node 24）：普通版出刊、高级版引擎与 NAS 工作台均为 TS，Python 只作为离线对照、发布控制与历史实现保留。

### 代码结构

- `packages/ordinary-news`：普通版完整链路（采集、IT之家评分排序、出刊、SMTP 投递、订阅同步、公开归档），被部署到 NAS 作为正式出刊端
- `packages/news-engine`：高级版 TS 引擎（多来源采集、模型审稿、预算、组稿、90 天归档）
- `packages/news-common`：两版共用的日期、归档、状态与同步工具
- `apps/nas-dashboard`：NAS 局域网只读工作台，统一查看普通版/高级版的新闻、AI处理、评分、费用、邮件与调度；[部署说明](deploy/dashboard/README.md)
- `apps/subscription-web`：React + Tailwind CSS 订阅网页与 Vercel API
- `deploy/ordinary`、`deploy/nas`：版本控制器、发布/回退、三天观察与切换工具；[普通版说明](deploy/ordinary/README.md)
- `src/*.py`：旧 Python 发送实现，保留作离线对照与 fork 兼容，不再是线上出刊路径（邮件入口 `src/main.py`、文案 `notifications.ini`）

## 工具部署

在2024年6月21日的更新后，功能变得更加丰富，目前我们有新闻的归档，同时做了排序筛选等等功能。原 [EmaiListInbox](https://github.com/nowscott/EmaiListInbox) 订阅服务现已合并到本仓库的 `apps/subscription-web`，形成从订阅登记到每日发送的完整流程。

如果你不需要表单功能，目前我将邮箱列表放在了notion上，你只需要拷贝这个页面：[notion页面](https://nowscott.notion.site/029f3f6fc18f40278acfa69739f4eacb?v=2bd422a503204d3aa220fdadc3e89de0)，接下来获取到一个notion的密钥和仓库的id，填写到下面的secret中就可以了。

由于我将私密性的信息全部放到了仓库的秘密变量中，所以现在可以通过Fork的形式来进行部署。

首先Fork本仓库：https://github.com/NowScott/EverydayTechNews

接下来在设置（Settings）中找到 Secrets and variables，点击 Actions，新建 6 个 repository secret：
```
SENDING_ACCOUNT: send_email@example.com
SENDING_PASSWORD: smtp_password
SERVER: smtp.163.com
NOTION_API_KEY=your_notion_api
NOTION_DATABASE_ID=your_database_id
SUBSCRIPTION_CONFIRMATION_SECRET=your_long_random_secret
```

1. 前两个分别是要使用的邮箱和SMTP的密钥

2. 关于服务器（server），它取决于您使用的电子邮件地址。这里我提供了使用网易163邮箱地址的示例。其他常用电子邮件提供商的服务器地址列在最后。

3. `NOTION_API_KEY` 和 `NOTION_DATABASE_ID` 分别是 Notion 集成密钥与数据库 ID，请记得将数据库连接到对应集成。

4. `SUBSCRIPTION_CONFIRMATION_SECRET` 用于签署确认和退订链接，必须与 Vercel 中的同名变量保持一致。

Notion 数据库需要包含 `Name`、`Email` 和 `状态` 三列，状态选项包括 `待确认`、`正常`、`已退订` 和 `异常`。只有状态为 `正常` 的订阅者会收到邮件；其他状态都会跳过。如果同一地址连续三次被 SMTP 以 5xx 永久拒绝，程序会自动将该记录改为 `异常`。SMTP 登录失败、网络超时等系统故障不会修改订阅者状态。

到这里部署就已经结束了，好像是比之前直接把发送的地址填写到secert的方式麻烦了一些，但是提供了更多的功能。

### 部署订阅网页

订阅网页位于 `apps/subscription-web`，技术栈为 React、TypeScript、Tailwind CSS 和 Vite，支持跟随系统浅色/深色模式。

生产地址：https://mailist.nowscott.top/

在 Vercel 导入本仓库后：

1. 将 Root Directory 设置为 `apps/subscription-web`
2. 配置 `NOTION_API_KEY` 和 `NOTION_DATABASE_ID`
3. 配置 `APP_BASE_URL` 和 `SUBSCRIPTION_CONFIRMATION_SECRET`，用于生成确认和退订链接；签名密钥必须与 NAS 出刊端的 `ordinary.env` 中同名变量一致
4. 配置 `SENDING_ACCOUNT`、`SENDING_PASSWORD` 和 `SERVER`，用于向新订阅者发送确认邮件；如需在确认后接收站长通知，再配置 `NOTIFICATION_EMAIL`
5. 将 `mailist.nowscott.top` 绑定到该 Vercel 项目

订阅 API 会先写入 `状态=待确认`。订阅者通过邮件中的签名链接打开简洁确认页，并点击确认按钮后，才会更新为 `状态=正常` 并进入每日发送名单；随后系统会另发一封订阅成功邮件。确认邮件会明确展示 24 小时链接的失效时间，确认后不可重复使用。

每日早报底部包含按收件邮箱签名的退订按钮。按钮先打开退订确认页，只有用户主动确认后才会更新为 `状态=已退订`，避免邮件安全扫描器误退订；链接有效期为 45 天。`已退订` 邮箱重新填写表单时会恢复为 `待确认` 并重新确认，`异常` 邮箱不会自动恢复。详细说明见 [`apps/subscription-web/README.md`](apps/subscription-web/README.md)。

最近也有一些朋友订阅了我的每日科技早报，目前的新闻源来自IT之家，滤除了营销信息的新闻，并且也写了一个排序算法，每天只发送排名前25的新闻。

## 功能与设计

- **自动采集与归档**：定时抓取 IT之家新闻并保存每日、每月归档，让早报内容可追溯。
- **筛选与排序**：统一过滤广告、价格、重复新闻及指定主题的中英文名称、系统、芯片、终端和汽车生态关联词，再根据读者评分为候选内容排序，每天只发送排名前 25 的新闻；发送前会再次过滤已排序归档，确保新规则立即生效。
- **日期标识**：每日邮件主题与正文头部统一显示上海当天日期，便于在邮箱列表和正文中快速定位。
- **轻量化处理**：采集优先解析 IT之家列表页，异常时自动降级到同站 RSS；评分直接请求轻量接口，不为每条新闻启动完整浏览器。
- **订阅闭环**：订阅网页、邮箱确认、Notion 状态管理、每日发送和安全退订都在同一仓库中维护。
- **可靠发送**：批量发送复用单个 SMTP 会话，断线时自动重连；区分永久退信与临时系统故障，只有连续永久拒收才会将订阅者标记为 `异常`。
- **可靠调度**：NAS 定时器在上海时间 06:30 发起投递，未完成可恢复至 09:00，09:00 后不再发起；账本按收件人与日期去重，进程重启不会重复群发。
- **移动端优先**：订阅页和邮件针对窄屏阅读、触控区域与操作入口进行适配。

抓取发送端与订阅网页共享数据约定，但保持独立部署：出刊端运行在自有 NAS 上（自 2026-10-29 起不再由 GitHub Actions 定时触发），React 网页与 API 由 Vercel 运行，两端通过 Notion 协作。这样既保证 06:30 准点出刊，也不会让网页部署与定时邮件任务相互影响。

各版本的具体变化与技术背景见 [`CHANGELOG.md`](CHANGELOG.md)。

## 未来想法

- [x] 优化排序算法
- [x] 在爬取新闻时筛选无用新闻
- [x] 合并邮件任务和订阅表单的代码仓库
- [x] 为 IT之家列表页抓取增加重试，并接入同站 RSS 作为降级抓取方法
- [ ] 增加新闻源健康检查与异常提醒，持续观察列表页、RSS、排序和邮件发送的成功率
- [ ] 保留 RSS 正文摘要字段，清洗广告、商品卡片和图片 HTML，为后续简报生成提供更完整的上下文
- [ ] 建立主题标签与权重体系，支持 AI、大模型、芯片、软件系统、消费电子、智能汽车等方向化筛选
- [ ] 支持订阅者选择关注主题、邮件频率和每日新闻数量
- [ ] 增加“有价值 / 无价值”反馈入口，用真实阅读反馈持续优化排序
- [ ] 提供可搜索的 Web 历史归档与 RSS 输出，让内容不只存在于邮件中
- [ ] 增加抓取、排序、发送成功率和退信情况的运行看板与异常提醒
- [ ] 接入模型生成带原文链接的每日简报，先对筛选后的新闻生成摘要，再保留无模型时的现有发送流程
- [ ] 在保证信息密度的前提下评估更多新闻来源，但优先稳定当前 IT之家同源多方法抓取链路

## 高级订阅内部实验

独立实验入口、运行和审阅说明见 [experiments/premium/README.md](experiments/premium/README.md)。新增持久化新闻池、独立采集/评分/精编/组稿/测试投递阶段，目标5条重点＋10～15条短讯；五项兴趣同级加权，正文和原始响应单独保存90天。普通版行为不变，测试收件人由Notion高级内测标记管理；已有20篇旧版真实模型样本，新版双长度API、人工事实审阅和七天试刊分别验证，未部署生产。

高级订阅的TypeScript完整引擎位于 [packages/news-engine](packages/news-engine/README.md)，包含采集、编辑、模型预算、持久化、组稿、投递和90天归档，以及Python对照和故障测试。私有内测通过Notion的高级订阅及高级内测标记选择收件人，普通订阅不变；部署状态见[迁移记录](packages/news-engine/MIGRATION.md)。[第一批评分测速](packages/news-engine/PERFORMANCE.md)不代表完整链路提速。

## 架构：NAS 自主调度（已脱离 GitHub Actions 定时）

普通版从 2026-10-28 起由 NAS 自己的定时器出刊，2026-10-29 完成切换，GitHub Actions 里的三个旧工作流（`technews.yml`、`news-sorter.yml`、`run-selenium-script.yml`）已停用，只保留测试与构建校验类工作流。

**为什么改**：GitHub Actions 的 cron 是"尽力而为"的排队调度，高峰期经常延迟十几分钟到半小时，06:30 的早报无法保证准点；而且失败重试只能靠再次排队。换成 NAS 常驻调度后，时间点由本机时钟决定，晚到可恢复到 09:00 的窗口，进程重启不会重复群发。

**当前调度**（上海时区）：

| 任务 | 频率 | 作用 |
|---|---|---|
| 常驻调度服务 `scheduler`（容器 `etn-ordinary-scheduler`，镜像内 `scheduler.ts`） | 05:00–09:59 每 2 分钟，其余时段 :07/:37 | 进程内直接执行 tick，采集、冻结、投递，06:30 起发 |
| `manage.py update` | 每小时 :17 | 检查正式 Release，固定提交与镜像摘要后自动部署 |
| `manage.py sync` | 每天 06:40 / 08:40 / 12:40 / 20:40 | 把 `news_archive/YYYY-MM/DD.md` 增量推到本仓库 |
| `manage.py scheduler-up`（看门狗） | 每 10 分钟 | 只保证调度容器在跑；已在运行时不重启 |

从 2.7.2 起出刊不再"到点起一个一次性容器"，而是由常驻进程按同一套时间表在进程内调用；省掉每轮约 0.3 秒的容器创建，也不会再有分钟级排队抖动。手动 `manage.py run` 会先停常驻调度、跑完再拉起，避免两路同时写状态。

GitHub 在切换后只承担两件事：源码与 Release 的版本记录、公开新闻归档的存放。**出刊链路不依赖 GitHub 可用性**——归档推送失败不影响出刊（`archive_sync` 会在报告中标记失败原因并保留积压）。

版本号口径见 [`VERSIONING.md`](VERSIONING.md)：一个组件版本同时是 git tag、GitHub Release、Docker 镜像 tag 与部署记录，不再产生第二套编号。历史 Python 版本（`v1.0.0`、`v2.x`）已冻结，仅作归档。

三天观察与正式切换的完整流程见[普通版部署说明](deploy/ordinary/README.md)。

