# EverydayTechNews(每日科技新闻)

每天早晨自动发送科技新闻到你的邮箱。

点击[这里](https://mailist.nowscott.top/)订阅每日科技早报

[![Star History Chart](https://api.star-history.com/svg?repos=nowscott/EverydayTechNews&type=Date)](https://star-history.com/#nowscott/EverydayTechNews&Date)

[![新闻抓取][action-image]][action-url]
[![forks][forks-image]][forks-url]

[action-url]:[https://github.com/NowScott/EverydayTechNews/actions/workflows/technews.yml "Action State"
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

这个自动发送新闻到邮箱的小工具是基于python开发的，主函数是根目录下的main.py文件，然后配置文件是根目录下的config.json。

## 工具部署

在2024年6月21日的更新后，功能变得更加丰富，目前我们有新闻的归档，同时做了排序筛选等等功能，以及搭配[EmaiListInbox](https://github.com/nowscott/EmaiListInbox)仓库实现订阅表单的功能。

如果你不需要表单功能，目前我将邮箱列表放在了notion上，你只需要拷贝这个页面：[notion页面](https://nowscott.notion.site/029f3f6fc18f40278acfa69739f4eacb?v=2bd422a503204d3aa220fdadc3e89de0)，接下来获取到一个notion的密钥和仓库的id，填写到下面的secret中就可以了。

由于我将私密性的信息全部放到了仓库的秘密变量中，所以现在可以通过Fork的形式来进行部署。

首先Fork本仓库：https://github.com/NowScott/EverydayTechNews

接下来在设置（Settings）中找到Secrets and variables，点击下方的Actions，在右侧你可以看到一个蓝色的按钮写着New repositorys secret，点击这个按钮，新建5个secret，分别是：
```
SENDING_ACCOUNT: send_email@example.com
SENDING_PASSWORD: smtp_password
SERVER: smtp.163.com
NOTION_API_KEY=your_notion_api
NOTION_DATABASE_ID=your_database_id
```

1. 前两个分别是要使用的邮箱和SMTP的密钥

2. 关于服务器（server），它取决于您使用的电子邮件地址。这里我提供了使用网易163邮箱地址的示例。其他常用电子邮件提供商的服务器地址列在最后。

3. 后两个分别是notion的api还有数据库的id，这些分别是从[我的集成](https://www.notion.so/my-integrations)网站获得的密钥，以及您的Notion数据库的ID，当然也不要忘记给你的数据库连接集成。

到这里部署就已经结束了，好像是比之前直接把发送的地址填写到secert的方式麻烦了一些，但是提供了更多的功能。

最近也有一些朋友订阅了我的每日科技早报，目前的新闻源来自IT之家，滤除了营销信息的新闻，并且也写了一个排序算法，每天只发送排名前25的新闻。

## 最新更新

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
  - 邮件发送：每日上海时间 08:30 执行
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
 * [ ] 合并当前库和订阅表单的仓库
 * [ ] 接入模型直接生成简报（很未来再实现吧）
