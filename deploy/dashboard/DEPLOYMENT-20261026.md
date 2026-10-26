# NAS 修复与线上验收：2026-10-26

所有时间为上海时间。核查及本次部署不触发抓取、模型、人工补刊或邮件，不修改历史期刊、费用、发送账本或试刊开关。

## 生产基线核实

- 新闻引擎正式 Release：news-engine-v0.7.1；提交 `3e3ecb557cc596d4d1a5cc628a65b29d49cca116`。NAS deployment.json、镜像标签、源码及看板版本投影一致。镜像 `sha256:4a8eaf8d2d604508c3db0f3140e3fa9d1a8a3b00e43182d770858ab2d11902f9`，09:17:22 部署，控制器记录 `offline_state_and_ledger_passed`；14:00 自动检查 up_to_date。
- 调度通过看板观察包装调用受管理 run，读取 controller config.json 指定的数据目录；其 trial.json 为 testing_period=continuous、days=null、expires_at=null，enabled/model_enabled/delivery_enabled=true，production_enabled=false，每日预算2元。已部署生成入口向 gate 传入 trialDeadline(config)。未重新部署引擎。
- 原看板 v1.4.2 健康，提交 `19ade475585bc6eb0b3f2c96df8471ba261b9eec`。实际发现：早间诊断刊有 frozen_at，而已有人工样刊及修订仅有 created_at，最新正常刊因此未被首页、列表及告警正确选中。
- 今日人工样刊、投递及45次模型调用在本次核查前已经存在，不是本次触发，不能作为下一轮正常定时出刊恢复的证明。

## 看板 v1.4.3 修复与发布

- [PR #31](https://github.com/nowscott/EverydayTechNews/pull/31) 合并提交 `b46e4b2490f750c9ef117a3a70948b3b459e59f1`；[正式 Release](https://github.com/nowscott/EverydayTechNews/releases/tag/nas-dashboard-v1.4.3)。
- 统一首页、告警和期刊列表排序：依次使用有效的 frozen_at、created_at、collection_cutoff、期刊日期，比较实际时刻；同时间修订按编号稳定排序。不为历史记录伪造冻结时间，不改业务状态。
- 本地32项看板测试、类型检查/生产构建、2项部署测试通过；引擎恢复测试29项通过。新增回归覆盖缺少 frozen_at、UTC/上海时间比较、同时间历史修订和较新诊断刊重新告警。
- [主分支 CI](https://github.com/nowscott/EverydayTechNews/actions/runs/40278916999) 通过，包含测试、构建和 Docker 检查。
- 源码归档 SHA256：`4860ad2ed543fcffb32067ddb5ff6b62b50bd2a2b39a522bfce0fcb830a38646`；NAS源码目录 `/vol3/1000/Docker/everydaytechnews-dashboard-sources/1.4.3`。
- 使用核对过的 Node 24 基础镜像 `sha256:a797d6440ed0b09e51fb884f30e47ec14cbf58482c5e19db681a0cb8df45b089`；新镜像 `sha256:ca507ec74b4dd2bba9351e6a34e72a0386a0b16a71d323a75a824947a0322fae`。无网络、只读容器启动检查通过。
- 14:18:26 备份 compose.env、dashboard.env、installation.json、compose.yaml 至看板目录 `backup-1.4.3-20261026-141826`。仅替换 DASHBOARD_IMAGE 并更新 dashboard 服务及安装元数据；容器健康，正文采集容器启动时间、crontab 未变。

## 14:19:14 线上只读验收

- 健康接口 v1.4.3；登录读取通过，未登录访问用量接口返回401。
- 首页和期刊列表一致选中 `sample-ts-makeup-2026-10-26-r-093830`：正常刊、16条、4来源、SMTP已接收；旧诊断刊告警清除。收件状态仍为 not_verified。
- 今日45次调用：输入97,560、输出21,242、总118,802 Token，缓存命中9,728；已知估算费用0.34598912元，未知费用/用量为0；重复调用2次、估算0.00903256元。独立SQLite副本核对今日费用、Token及全部分页通过；未重做历史7天全量核对。
- 两个业务数据目录共22个账本/投递相关文件验收前后哈希一致；验收报告位于看板私有目录 `acceptance-1.4.3-20261026.json`。本次没有变更引擎镜像或业务配置。

## 待完成的真实定时验收

- 2026-10-27 首个完整晨间窗口结束后09:20复核；已补充现有一次性自动化“新闻链路首个完整窗口复核”，未创建重复监控。
- 核对实际生产版本、连续内测配置、候选/生成/审核/正常刊、费用及SMTP账本；不得以退出码0或既有人工样刊冒充恢复成功。若仍为诊断刊，依据已有受控错误定位原因，不额外发起模型、抓取或补发。
- 确认不再因旧日期 trial_expired 停止；若因其他价格、窗口、预算或证据限制阻断，应记录实际原因，保持保护条件。
- 实际收件需人类确认，本次不写收件反馈。上述待验收项目完成前，不宣称正常定时出刊及收件已全部恢复。

## 回滚

看板原镜像 `sha256:7ef271c3d5dc4f57a7ec5e58d15eed961ebe5eaf288b68bbffb30772bd4b9922`。使用上述备份中的 compose.env 恢复旧镜像，沿用当前 compose.yaml 执行仅 dashboard 的 `up -d --no-deps --wait`，再核对健康和安装元数据。失败时只回退代码/镜像，不恢复旧数据库、费用、冻结期刊或发送账本；不重装调度。
