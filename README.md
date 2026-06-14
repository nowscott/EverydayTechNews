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
- `src/news_filter.py`：统一的广告与价格新闻过滤规则
- `src/newsletter.py`：选择新闻并生成邮件 HTML
- `src/notion_client.py`：读取订阅者并更新订阅状态
- `src/subscription_links.py`：生成每日邮件中的签名退订链接
- `src/mailer.py`：SMTP 发送、重试与失败分类
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

## 最新更新

### 2026年6月 - v2.4.1 移动端邮件与订阅体验优化

大多数早报会在手机邮箱中阅读，因此本次重点处理窄屏下的阅读顺序、触控区域和退订入口可见性，避免订阅表单被长篇介绍挤到首屏之外，也避免退订按钮融入深色页脚。

- 优化订阅页与邮件在手机窄屏下的字号、留白、表单和按钮触控区域
- 移动端按“缩小标题、订阅表单、补充说明与运行数据”的顺序展示
- 订阅按钮和退订确认按钮在 320px、390px 窄屏下严格居中
- 订阅页根据连续无缺口的归档起点 `2024-06-04` 动态展示稳定运行天数
- 将早报黑色页脚中的退订入口改为高对比度浅色按钮，提升可发现性

### 2026年6月 - v2.4.0 邮箱确认、邮件样式与安全退订

- 确认邮件展示签名链接的准确失效时间，默认有效期为 24 小时
- 重写每日早报 HTML，使用更适合邮箱客户端的内联样式与表格布局
- 每条新闻增加序号与更清晰的阅读层级，通知区和页脚统一视觉
- 每封早报包含按收件邮箱签名的退订按钮，退订链接有效期为 45 天
- 退订链接先进入确认页，用户主动确认后才将 Notion 状态更新为 `已退订`
- 退订用户仍可重新填写订阅表单，完成邮箱确认后恢复订阅

### 2026年6月 - v2.3.0 订阅服务合并与重构

#### 为什么合并 EverydayTechNews 与 EmaiListInbox

两个仓库实际上属于同一个产品流程：

- `EmaiListInbox` 负责接收用户订阅并写入 Notion
- `EverydayTechNews` 从同一个 Notion 数据源读取订阅者并发送每日早报

长期分仓维护导致两端的接口约定逐渐不一致。发送端已经要求订阅者的 `状态` 为 `正常`，旧订阅端却只写入 `Name` 和 `Email`；Notion API、Node.js 依赖、安全修复、部署说明和测试也需要分别维护。用户可能看到“订阅成功”，但数据未必满足发送条件。

因此本次将订阅服务迁入 `apps/subscription-web`，统一 Notion 字段契约、测试、文档、Issue 和版本发布。合并仅发生在代码仓库层面，运行边界仍保持独立：

- Python 抓取、排序和邮件发送继续由 GitHub Actions 运行
- React 订阅网页和 API 继续由 Vercel 部署
- 两端通过同一 Notion 数据源协作

#### 主要更新

- 使用 React、TypeScript、Tailwind CSS v4 和 Vite 重写订阅网页
- 全新响应式视觉设计，自动跟随系统浅色/深色模式
- Notion API 升级到 `2026-03-11` data source 接口
- 新订阅自动写入 `状态=正常`，与邮件发送端保持一致
- 增加邮箱去重、同实例并发保护、IP 限流、蜜罐和输入校验
- Nodemailer 升级并将 npm 依赖审计清零
- 新增 7 项 Web 自动测试及独立 GitHub Actions 工作流
- Vercel 升级至 Node.js 24，并改为连接本仓库的 `apps/subscription-web`
- 生产地址继续使用 https://mailist.nowscott.top/

#### 线上验证

- Vercel 生产部署及 Git 自动部署成功
- 首次测试订阅返回 `201 subscribed`
- 相同邮箱连续提交返回 `200 existing`
- Notion 中确认只创建一条记录
- 测试记录已改为 `异常`，不会进入正式群发
- Python 28 项测试和 Web 7 项测试全部通过

### 2026年6月 - v2.2.1 邮件任务可靠性更新

- 邮件定时任务改用显式 `Asia/Shanghai` 时区，每日 07:23 执行
- 避开整点和半点的 GitHub Actions 调度高峰
- 增加邮件任务并发保护，避免定时任务和手动任务重叠发送
- Action 日志增加触发方式、UTC 时间和上海时间
- 邮件日志增加新闻文件、收件人数及成功/失败汇总
- 新闻文件缺失或没有有效条目时明确失败，不再静默显示成功

### 2026年6月 - v2.2.0 抓取、排序与邮件流程重构

#### 为什么排序明显变快

旧版排序会为每一条新闻启动浏览器访问完整文章页，等待图片、脚本、广告和评分区域加载完成，再从 DOM 中读取“有价值 / 无价值”票数。每天约有 130-160 条新闻需要评分，因此浏览器页面加载和 JavaScript 等待占据了绝大多数时间，还容易受 ChromeDriver、页面超时和网页结构变化影响。

新版直接请求文章页本身使用的轻量评分接口 `https://dyn.ithome.com/grade/{新闻ID}`，解析接口返回的票数，并使用最多 8 个并发请求完成评分。评分公式和排序规则保持不变，但不再加载完整网页，也不再依赖 Selenium、Chrome 或 ChromeDriver。

实测结果：

- 本地 156 条新闻：131 个评分请求，0 失败，约 3.36 秒完成
- GitHub Actions 186 条新闻：154 个评分请求，0 失败，排序脚本耗时 18.58 秒
- 旧版同规模线上排序约需 210 秒，新版线上约提升 11 倍
- 排序后的前 25 条无价格广告、推广链接或重复 URL

#### 新闻抓取优化

- 新闻列表由 Selenium 改为 Requests + BeautifulSoup
- 列表页原始 HTML 已包含标题、分类、链接和时间，无需启动浏览器
- 抓取失败会让 Action 正确失败，不再出现任务显示成功但没有新闻的情况
- 按 URL 和相似标题去重，已排序的日归档不会再被后续抓取破坏

#### Notion 与邮件可靠性

- Notion API 升级到 `2026-03-11`，支持 data source 和超过 100 条记录的分页
- 只向状态为 `正常` 的订阅者发送，`异常` 或空状态会跳过
- 邮箱地址自动去重，姓名为空时使用默认称呼
- 同一收件人连续三次被 SMTP 以 5xx 永久拒绝时，自动将 Notion 状态改为 `异常`
- SMTP 登录失败、网络超时等系统故障不会错误停用订阅者
- 增加单收件人线上测试模式，测试时不读取或修改 Notion

#### 工程与安全

- 将 Notion、SMTP、邮件内容和任务编排拆分为独立模块
- Python 固定为 `3.14`，GitHub Actions 更新到 Node 24 兼容版本
- 新增 26 项自动测试，并在 push 和 pull request 时运行
- Requests 升级到 `2.33.0`，修复 `CVE-2026-25645`
- 抓取、排序和自动提交增加并发控制及推送前 rebase

### 2025年1月 - 代码质量优化

#### 🔧 新闻过滤模块重构
- **创建通用过滤模块** (`src/news_filter.py`)：将重复的过滤逻辑提取为独立模块
- **统一过滤标准**：确保 `main.py` 和 `news_sorter.py` 使用相同的过滤规则
- **提高代码复用性**：消除了代码重复，提升了可维护性

#### 💰 货币过滤功能增强
- **扩展货币支持**：新增支持全球主要货币的过滤
  - 亚洲货币：韩元(₩)、港币(HK$)、台币(NT$)、新加坡元(S$)、泰铢(฿)等
  - 欧美货币：欧元(€)、英镑(£)、澳元(A$)、加元(C$)、瑞士法郎等
  - 其他货币：印度卢比(₹)、俄罗斯卢布(₽)、巴西雷亚尔(R$)等
- **符号识别**：支持货币符号和文字表示的双重识别
- **数量级完整**：包含千、万、亿等不同数量级的货币表示

#### 🚀 工作流时间优化
- **调整执行时间**：
  - 新闻排序：每日上海时间 00:30 执行
  - 邮件发送：每日上海时间 07:23 执行
- **时区适配**：确保在中国时区的最佳执行时间

#### 📈 智能备用机制
- **备用过滤逻辑**：当排序工作流失败时，自动启用简单过滤机制
- **质量保证**：即使在异常情况下也能确保发送25条高质量新闻
- **排序检测**：智能检测新闻文件是否已排序，避免重复处理

## 未来想法

 * [x] ~~优化排序算法~~ ✅ 已完成货币和广告过滤优化
 * [x] ~~在爬取新闻时就筛选掉无用新闻~~ ✅ 已实现通用过滤模块
 * [ ] 优化新闻源（目前还没找到很好的）
 * [ ] 集成更多新闻源（一个想法而已，去掉繁杂的信息比较困难）
 * [x] ~~合并当前库和订阅表单的仓库~~ ✅ 已完成 React + Tailwind CSS 重构
 * [ ] 接入模型直接生成简报（很未来再实现吧）
