# NAS 新闻工作台

独立的局域网只读看板：运行总览、新闻处理、冻结期刊、发送账本和调度记录。业务读取不导入两个引擎的 Store，不调用模型、SMTP、Notion、Docker 或业务 CLI。

## 本地开发

Node 24。`npm ci` 后执行 `npm test`、`npm run build`。运行服务时设置 `DASHBOARD_ORDINARY_DATA`、`DASHBOARD_PREMIUM_DATA`、`DASHBOARD_RUNTIME` 为已有目录；`DASHBOARD_ORDINARY_DEPLOYMENT` 和 `DASHBOARD_PREMIUM_DEPLOYMENT` 为仅含 deployment.json 的公开投影目录。禁止指向或挂载整个 managed 目录，以免暴露私有控制器配置。

`npm run password --silent` 从标准输入读取不少于12个字符的密码并输出 scrypt 哈希。只将哈希存放在私有环境文件的 `DASHBOARD_PASSWORD_HASH`，不要将明文密码放进命令参数。`npm start` 默认端口3080；`npm run dev` 的 Vite 会把 `/api` 转发给同端口的后端。生产由后端提供 dist，不需要 Vite。

## 数据与接口

除 `/api/health` 外均需登录；登录与退出为 POST，其余业务接口仅允许 GET：

- `/api/overview`：普通版、高级版的当日概况。
- `/api/news`、`/api/news/:id`：新闻列表与详情。
- `/api/issues`、`/api/issues/:id`：冻结期刊、文本预览与脱敏发送账本。
- `/api/runs`：外层调度记录和已有采集/错误证据。

参数：`component=ordinary|premium`，`from/to=YYYY-MM-DD`（默认上海时间最近7天，单次最多31天），`page`（每页30条）；新闻列表支持 `q/source/stage/sort=score|date`。详情使用同一日期区间。返回 read_at、read_state 和 evidence 中的逐来源读取状态、文件时间。数据库忙、缺失或损坏不会回退到旧快照。每次数据库读取先复制DB及可能存在的WAL到私有临时目录，核对整个复制前后的inode/大小/纳秒修改时间一致后，以只读连接、query_only和同一事务读取。SQLite辅助文件仅允许在临时副本创建，查询后删除临时副本；不对活跃源数据库使用immutable。复制冲突最多重试3次，源DB+WAL超过192MB或仍在变动时明确提示无法读取。

普通版日期按来源新闻归档日，未保存的抓取时间保持空值；不虚构 AI 改写、调用数和费用。高级版按文章ID+正文指纹去重，日期为首次抓取日；评分来自已有任务，未入队文章保持未评分，不重新执行评分。改写完成与审核通过分开，入选期刊不代表已发送。AI费用是账本估算，未知费用只展示预留额。

SMTP accepted 仅表示服务器接收；只有普通版现有 feedback/received_confirmed 证据才显示收件箱确认。发送结果未知不触发重发。所有邮件仅做 React 文本预览，不执行 HTML，不加载远程邮件图片或退订链接。邮箱脱敏，密钥字段不返回。

调度记录成功退出显示等待下次调度；普通版超过3分钟、高级版晨间超过20分钟/其他时段超过40分钟没有完成记录时提示逾期；运行超过45分钟显示结果待确认。没有外层记录时显示未知，不用旧业务报告冒充进程存活。业务投递窗口依据既有09:00截止规则及当前启用模式检查，不改变任何业务调度。

部署、密码轮换、更新和回滚见仓库 deploy/dashboard/README.md。


## v1.1 原文阅读

新闻详情默认打开“原文阅读”，并将AI改写、评分/审核分成独立页签。高级版先读取已有采集正文，按来源标注正文或摘要；不调用模型、不在浏览请求中访问外网。普通版和缺少正文的高级版由独立body-collector每5分钟扫描最近7天新闻，补抓允许来源的公开HTTPS正文，保存在独立bodies目录，不改写业务库。每轮最多60篇、每域名20篇、每版40篇，间隔800ms，整轮150秒预算；失败6小时后重试，最多3次，访问受限不绕过。历史积压逐轮补齐。

缓存按URL哈希存储，包含抓取时间、正文SHA256及明确的失败原因。网页只读挂载缓存；collector仅能写缓存，不挂载业务密钥。HTML正文仅抽取文本、清除脚本和导航广告；不执行来源HTML或加载远程图片。未支持的来源、未找到正文及访问限制保持明确提示，可跳转来源网站。正文缓存独立于付费AI的证据生命周期，也不把摘要声称为完整原文。


## v1.1.1 收件确认提示

feedback/YYYY-MM-DD.json是可选的人工收件确认记录。仅在文件不存在时标为not_recorded，作为普通信息展示，不计入read_state的partial或页面黄色告警；收件状态仍为未确认。文件存在却无法读取或JSON损坏时仍告警，其他必需数据缺失、损坏和数据库忙也继续告警。接口和页面共用同一状态判定，不通过生成虚假确认文件来消除提示。


## v1.2 今日早报与邮件版式预览

默认首页展示所选版本的最新冻结期刊、前5条冻结精选和当天6条新抓取内容，并记住本机版本选择。精选从期刊comparison.json中的记录读取，不采用后来修改的写作任务；缺少冻结摘要不临时生成。原文入口通过期刊索引读取冻结记录及已有原文。今天未出刊和诊断刊有独立提示，状态页保留原有详细监控。

新增GET /api/home?component=...、GET /api/issues/:id/articles/:index?component=...和GET /api/issues/:id/preview?component=...&receipt=...，均受原有登录保护。期刊详情增加preview元数据和脱敏收件版本，JSON不返回原始HTML。普通版优先选择最近一次SMTP接收的账本版本，高级版以原始HTML核对冻结SHA256；无可验证HTML时不以现有模板冒充历史发送。

HTML经清理后在无allow权限的sandbox iframe中呈现；预览接口使用独立CSP，允许原有内联排版，禁止脚本、外部资源、表单和链接操作。原应用CSP只放行同源frame，其他保护保持不变。所有预览均只读，不调用模型、SMTP或外部新闻抓取。

登录使用180天HttpOnly Cookie，服务端仅将随机令牌的哈希保存到看板独立auth目录，刷新和容器重启后保留。主动退出立即撤销会话，修改密码使旧会话失效；浏览器清除Cookie或180天到期后需重新登录。不在localStorage存储密码，不缓存业务API响应。
