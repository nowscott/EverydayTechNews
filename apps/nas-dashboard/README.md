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
