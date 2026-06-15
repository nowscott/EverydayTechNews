# EverydayTechNews(每日科技新闻)

每天早晨自动发送科技新闻到你的邮箱。

点击[这里](https://mailist.nowscott.top/)订阅每日科技早报

[![Star History Chart](https://api.star-history.com/svg?repos=nowscott/EverydayTechNews&type=Date)](https://star-history.com/#nowscott/EverydayTechNews&Date)

[![新闻抓取][action-image]][action-url]
[![forks][forks-image]][forks-url]

[action-url]: https://github.com/NowScott/EverydayTechNews/actions/workflows/run-selenium-script.yml "Action State"
[action-image]:https://img.shields.io/github/actions/workflow/status/nowscott/EverydayTechNews/run-selenium-script.yml?label=新闻抓取
[forks-url]:https://github.com/NowScott/EverydayTechNews/forks
[forks-image]:https://img.shields.io/github/forks/NowScott/EverydayTechNews?label=Forks

## 创建初衷

小时候，家中的长辈常订阅报纸。然而，随着时代的变迁，报纸逐渐退出我们的视野，被无处不在的互联网新闻取而代之。

在这个广袤的信息海洋中，琳琅满目且杂乱无章，包含了大量的信息。但实际上，我对于关注的内容并不多。

因此，我创建了这个工具，每天自动将科技新闻发送到我的邮箱。

这样，我就不再淹没在大量信息中，而是像过去阅读报纸时一样，只专注阅读我最感兴趣的部分。

## 工具介绍

因为不想暴露我的个人邮箱，所以真正每天在运行的工具在另外一个私有库中，本项目的目的在于帮助同样有这个需求的朋友们搭建这样一个小工具。

这个自动发送新闻到邮箱的小工具基于 Python 开发，邮件入口是 `src/main.py`，通知文案配置位于根目录的 `notifications.ini`。

### 代码结构

- `src/script.py`：使用 Requests + BeautifulSoup 抓取新闻并写入归档
- `src/news_sorter.py`：并发请求 IT之家评分接口并排序
- `src/news_filter.py`：统一的广告、价格与主题关键词过滤规则
- `src/newsletter.py`：选择新闻并生成邮件 HTML
- `src/notion_client.py`：读取订阅者并更新订阅状态
- `src/subscription_links.py`：生成每日邮件中的签名退订链接
- `src/mailer.py`：SMTP 连接复用、断线重连、重试与失败分类
- `src/main.py`：加载配置并编排每日邮件任务
- `apps/subscription-web`：React + Tailwind CSS 订阅网页与 Vercel API

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
3. 配置 `APP_BASE_URL` 和 `SUBSCRIPTION_CONFIRMATION_SECRET`，用于生成确认和退订链接；签名密钥必须与 GitHub Actions 中的同名 secret 一致
4. 配置 `SENDING_ACCOUNT`、`SENDING_PASSWORD` 和 `SERVER`，用于向新订阅者发送确认邮件；如需在确认后接收站长通知，再配置 `NOTIFICATION_EMAIL`
5. 将 `mailist.nowscott.top` 绑定到该 Vercel 项目

订阅 API 会先写入 `状态=待确认`。订阅者通过邮件中的签名链接打开简洁确认页，并点击确认按钮后，才会更新为 `状态=正常` 并进入每日发送名单；随后系统会另发一封订阅成功邮件。确认邮件会明确展示 24 小时链接的失效时间，确认后不可重复使用。

每日早报底部包含按收件邮箱签名的退订按钮。按钮先打开退订确认页，只有用户主动确认后才会更新为 `状态=已退订`，避免邮件安全扫描器误退订；链接有效期为 45 天。`已退订` 邮箱重新填写表单时会恢复为 `待确认` 并重新确认，`异常` 邮箱不会自动恢复。详细说明见 [`apps/subscription-web/README.md`](apps/subscription-web/README.md)。

最近也有一些朋友订阅了我的每日科技早报，目前的新闻源来自IT之家，滤除了营销信息的新闻，并且也写了一个排序算法，每天只发送排名前25的新闻。

## 功能与设计

- **自动采集与归档**：定时抓取 IT之家新闻并保存每日、每月归档，让早报内容可追溯。
- **筛选与排序**：统一过滤广告、价格、重复新闻及指定主题的中英文名称、系统、芯片、终端和汽车生态关联词，再根据读者评分为候选内容排序，每天只发送排名前 25 的新闻；发送前会再次过滤已排序归档，确保新规则立即生效。
- **日期标识**：每日邮件主题与正文头部统一显示上海当天日期，便于在邮箱列表和正文中快速定位。
- **轻量化处理**：抓取使用 Requests + BeautifulSoup，评分直接请求轻量接口，避免为每条新闻启动完整浏览器。
- **订阅闭环**：订阅网页、邮箱确认、Notion 状态管理、每日发送和安全退订都在同一仓库中维护。
- **可靠发送**：批量发送复用单个 SMTP 会话，断线时自动重连；区分永久退信与临时系统故障，只有连续永久拒收才会将订阅者标记为 `异常`。
- **准时调度**：邮件任务在目标时间前提前唤醒，到上海时间 07:23 再发送，并通过每日标记阻止重复群发。
- **移动端优先**：订阅页和邮件针对窄屏阅读、触控区域与操作入口进行适配。

抓取发送端与订阅网页共享数据约定，但保持独立部署：Python 任务由 GitHub Actions 运行，React 网页与 API 由 Vercel 运行，两端通过 Notion 协作。这样既能统一产品流程，也不会让网页部署与定时邮件任务相互影响。

各版本的具体变化与技术背景见 [`CHANGELOG.md`](CHANGELOG.md)。

## 未来想法

- [x] 优化排序算法
- [x] 在爬取新闻时筛选无用新闻
- [x] 合并邮件任务和订阅表单的代码仓库
- [ ] 优化现有新闻源的质量与稳定性
- [ ] 在保证信息密度的前提下集成更多新闻源
- [ ] 增加新闻源健康检查与自动降级，避免单一来源异常影响整封早报
- [ ] 支持订阅者选择关注主题、邮件频率和每日新闻数量
- [ ] 增加“有价值 / 无价值”反馈入口，用真实阅读反馈持续优化排序
- [ ] 提供可搜索的 Web 历史归档与 RSS 输出，让内容不只存在于邮件中
- [ ] 增加抓取、排序、发送成功率和退信情况的运行看板与异常提醒
- [ ] 接入模型生成带原文链接的每日简报，并保留无模型时的现有发送流程
