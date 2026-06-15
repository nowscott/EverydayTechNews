# 更新日志

本文件记录 EverydayTechNews 的重要版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

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

- 针对 GitHub `schedule` 的不确定延迟，改为 07:23 前多次提前唤醒并等待到点发送
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
