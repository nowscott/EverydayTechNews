# NAS 工作台 v1.0.0 实机交付

2026-10-23，Asia/Shanghai。访问地址：http://192.168.31.10:3080，仅绑定NAS局域网IPv4。

- 安装目录：`/vol3/1000/Docker/everydaytechnews-dashboard`。原crontab保存在crontab-before.txt，私有配置备份为backup-*。
- 应用源码提交：`5eb50f10`，分支`codex/nas-dashboard`。归档SHA256：`4ec14f04095a9db6e08b9a4ed873a44b6f69d55c6a8213b4f8e5d4595f0c8895`。
- 部署源码目录：`/vol3/1000/Docker/everydaytechnews-dashboard-sources/1.0.0-5eb50f10-4ec14f04`。
- 镜像：`sha256:f4e7816c0d0b656c7737031e6e35e0351c1524aaacf65ce432ca21a01ce88fad`。基础镜像实机核对为Node 24.22.0，ID为`sha256:a797d6440ed0b09e51fb884f30e47ec14cbf58482c5e19db681a0cb8df45b089`。
- 健康检查healthy，根文件系统和业务挂载只读，restart=unless-stopped，不挂载Docker socket。空闲内存观测约72MiB，上限512MiB。
- 普通版保持ordinary-news-v1.0.4 / shadow，高级版保持news-engine-v0.6.1 / internal_test。没有更换业务镜像、模式或启用正式发信。

## 验收

- Node 8项测试、Python 2项观察器测试、TypeScript检查和生产构建通过。
- NAS实际Compose启动、容器重建、旧会话失效及重新登录通过。1440px桌面和390px手机布局通过，最终浏览器无控制台错误。
- 验证审核通过筛选、改写正文、评分和审核详情、当天高级版安全文本邮件预览及页面切换。跨页面列表用所属页面标识隔离，避免旧列表瞬态混入。
- 2026-10-23 16:56:08上海时间，最终verify-live.py核对普通版当日来源归档154条、高级版当日首次抓取1496条、89次模型调用和0.3189572元已知估算费用，均与独立SQLite/归档核对一致。这些数字仅代表验收快照。
- 同一查询窗口内，业务数据库、存在的WAL、持久状态及发送文件共15个文件的前后SHA256完全一致。看板未产生模型调用或邮件。机器验收报告位于NAS看板目录acceptance.json。
- 普通版自然调度已记录开始、结束和退出码0。高级版观察包装16:42安装，验收时尚未到下一个17:07自然调度，因此显示暂无执行记录；没有额外触发业务。高级版历史新闻、期刊、来源及发送记录已可读取。

初始密码仅保存在NAS看板目录initial-password.txt和用户本机私有交付文件，不进入源码、镜像或本文。本机登录信息为`/Users/nowscott/Documents/Codex/NAS新闻工作台登录.txt`（0600），桌面预览为同目录NAS新闻工作台预览.png。

## 同日 v1.1.0 原文阅读与样式更新

- 应用提交：`23f208627b14f79986e05182faec6c9a1e311db3`。归档SHA256：`35ce3cd6b0a629b4a9a171f77d3d6a2bf0bdf090cb1118715546bc12d80bb430`。
- 镜像：`sha256:44f9abcd4447f77af9c7d54aa65700ec5d7ae5c1fe977a1fdeec1c00c29442df`。NAS源码目录为`/vol3/1000/Docker/everydaytechnews-dashboard-sources/1.1.0-layout-35ce3cd6`。
- 统一原生下拉框箭头、44px控件高度和右侧44px留白；宽屏筛选采用七列布局。详情默认原文阅读，另有AI改写及评分审核页签。
- 新增独立body-collector，业务目录保持只读，唯一可写挂载为看板bodies目录，不挂载任何业务凭据。网页对bodies同样只读。原有业务调度和发信模式不变。
- 首批实机采集两篇IT之家正文分别2663和1564字符，接口与浏览器均能直接阅读；后续缓存验收时已有169篇available、12篇抓取失败、1篇访问受限（动态快照）。失败与摘要不冒充完整原文。
- 13项Node测试、2项Python观察器测试及生产构建通过。1440px桌面筛选和390px手机正文阅读通过，最终浏览器无控制台错误，两个Compose服务均healthy。
- 17:21:28上海时间的v1.1只读验收仍为15个业务文件哈希一致；当时高级版1521条首次抓取、89次模型调用及0.3189572元已知估算费用与独立证据一致。正文采集不调用模型或SMTP。
- 真实17:07高级版自然调度已被外层观察器记录；v1.0验收时的“暂无执行记录”现已自动补齐。
