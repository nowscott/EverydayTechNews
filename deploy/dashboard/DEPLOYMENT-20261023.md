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
