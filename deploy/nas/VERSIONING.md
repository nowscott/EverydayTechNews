# NAS 版本、发布与回退

源码以 GitHub `nowscott/EverydayTechNews` 为准。新闻引擎从 `news-engine-v0.4.0` 起独立编号，不改变原项目 `v2.x` 版本。NAS 只运行 Git 提交构建出的镜像，不直接修改容器或版本目录。

## 发布

1. 在 `codex/` 分支修改源码，同时更新引擎 package.json、package-lock.json、deploy/nas/release.json 与 CHANGELOG。
2. PR 检查通过后合入 main。等待 main 对应提交的 `TypeScript engine parity and recovery` 工作流通过（包含 Python/Node 测试、类型检查、部署测试和 Docker 构建）。
3. 在这个已通过的 main 提交创建 `news-engine-vX.Y.Z` 标签和正式 GitHub Release（命令使用 `gh release create <标签> --target <提交> --latest=false`，保留原项目 v2.x 的 Latest 标记）。不要移动已发布标签。草稿、预发布、普通推送和其他组件标签不会部署。
4. NAS 每 15 分钟检查一次；04:00–09:00 上海时间仅报告待更新。新版本构建后等待运行任务结束，备份私有状态，在无网络、无密钥的容器中验证副本，确认账本不变后切换。

`release.json` 的 `state_schema` 必须与当前 durable 状态一致；`automatic_deployment` 必须为 true，`controller_protocol` 必须为 1。需要不兼容迁移时设为 false，安排单独迁移，不能绕过检查自动更新。

## 日常操作

首次由发布源码执行 `python3 deploy/nas/install-managed.py --legacy <原部署根目录> --root <新的管理根目录>`。安装器保留原目录、配置、数据和镜像，成功验证后才替换本项目的计划任务，原始 crontab 保存为管理目录中的 crontab-before.txt。

以下命令中的 `<管理目录>` 指首次安装使用的 root：

```sh
python3 <管理目录>/manage.py --root <管理目录> status
python3 <管理目录>/manage.py --root <管理目录> update
python3 <管理目录>/manage.py --root <管理目录> rollback news-engine-v0.4.0
```

保留的首次迁移旧版可用 `rollback legacy-20261019` 回退。回退前同样验证最新数据副本，回退不覆盖实时数据或恢复旧账本。曾部署版本的最高版本号会保留，避免回退后下一轮自动升级回故障版本；发布更高的修复版本恢复自动更新。

状态输出包含当前版本、完整提交、镜像摘要、验证结果、备份位置及最近检查。构建和验证失败时原版继续运行，失败标签被阻止；请发布更高的修复版本。远程 API 暂时失败只记录错误，下次轮询重试。NAS 不保存 GitHub 写入 token。

管理目录包含 bare Git 仓库、独立版本 worktree、deployment.json、日志和最近三份私有状态备份；原 `.env`、data、logs 始终保留在原目录。保留最近三个成功部署和对应镜像。原部署目录作为首次恢复点保留，不自动清理。`deployment.json` 是调度读取的唯一切换依据，运行使用镜像摘要，不依赖可覆盖标签。

控制器和离线验证器在首次安装时固定复制到管理目录，后续源码更新不能静默替换它们；控制器协议升级须单独验证和安装。不要手工修改已发布 worktree。失败详情在 logs/commands.log、logs/deployments.jsonl，计划任务输出在 scheduler.log/updater.log。

回退与更新均使用和原调度相同的锁，另外锁定状态；新闻任务不会与切换重叠。新旧镜像都须能读取候选验证后的状态，费用、冻结期刊和 SMTP 记录必须保持一致。首次部署与更新验证不会调用模型或发送邮件。原内测邮箱、预算、试用到期和生产关闭设置继续生效。

控制器需要升级时，从新的正式标签执行安装器并加 `--upgrade-controller`（legacy/root 与首次安装相同）。安装器先独立验证该标签的 main 提交、检查和兼容协议，再锁定更新与调度，备份旧控制器后替换，随后部署并重新安装计划任务。此步骤不由普通自动更新静默执行。晨间新闻任务沿用引擎自己的最长运行边界，控制器不在 30 分钟时终止任务或释放调度锁。
