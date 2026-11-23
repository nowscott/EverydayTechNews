# NAS 看板部署与维护

## 首次安装

1. 在 NAS 上准备本版本源码，构建固定镜像：`docker build -f deploy/dashboard/Dockerfile -t everyday-tech-news-dashboard:1.0.0 .`。如使用已验证的本地 Node 24 镜像，传 `--build-arg NODE_IMAGE=<已核对镜像ID的本地标签>`；构建前后确认该标签的镜像ID不变，记录基础镜像ID和最终镜像ID。镜像不含业务状态、SMTP/模型密钥或管理密码。
2. 用镜像ID安装：`python3 deploy/dashboard/install.py --root /vol3/1000/Docker/everydaytechnews-dashboard --image sha256:... --bind 192.168.31.10 --source-commit <源码版本与构建归档SHA256>`。默认3080端口，冲突时安装在修改前退出，可指定 `--port`。安装目录必须不存在。
3. 安装器读取两个控制器配置来确定数据位置，但不把这些配置复制给网页。Compose只读挂载业务目录、看板运行记录和仅含版本信息的部署投影。网页密码哈希独立生成，不读取业务环境文件。
4. 先启动并等待看板健康，再给现有三条 run 调度命令加观察包装。其余 update、sync、health 调度保持原样；不立即执行任何业务任务。原 crontab 完整保存在看板目录 crontab-before.txt；观察记录在下一次自然调度出现。
5. 初始密码在看板目录 initial-password.txt，权限0600；dashboard.env仅含哈希。用户用局域网地址登录。安装器仅打印密码文件位置，不打印密码。

数据目录0700、业务文件0600，容器以现有NAS UID/GID读取。根文件系统只读，无 Docker socket，无 host 网络，只在指定NAS局域网IPv4绑定端口；restart=unless-stopped，healthcheck每30秒一次。CPU上限1核，内存512MB，另保留256MB临时文件系统。

业务数据库的一致性副本使用独立的私有 `snapshots` 目录，正常查询结束后删除；单份数据库及 WAL 合计上限为 1 GiB。升级已有安装前，先在看板根目录创建属主与业务进程一致、权限为 0700 的 `snapshots` 目录，再更新 Compose 配置。该目录可能包含订阅数据，不应归档或公开；异常退出后若有残留，确认相关进程已结束再清理。

正文采集器可从看板根目录的 0600 私有 `proxy.env` 读取代理设置；透明分流时该文件留空。升级已有安装须先创建此文件。详见 [OpenWrt 迁移](../nas/OPENWRT-MIGRATION.md)。

## 调度观察

record-run.py 用独立的非阻塞锁避免重叠，原业务锁仍保留。开始/结束/退出码原子写入看板自己的runtime目录。杀死观察器造成的旧running记录在45分钟后显示未知；不接管、恢复或重试业务。观察器文件、配置和运行记录不得放入受发布控制器完整性检查的业务源码目录。

运行记录不含命令参数、密钥或业务stdout。每个任务一个文件，长期保留，不自动删除；接口只按所选日期读取、分页返回。控制器版本变动会在下一轮自然任务时刷新脱敏部署投影；版本投影失败清空身份，不沿用旧版本冒充当前版本。

## 更新与回滚

构建、验证新镜像后，备份 compose.env、dashboard.env 和 installation.json 到独立的带时间戳目录。仅修改 compose.env 中的 DASHBOARD_IMAGE，再执行 `docker compose --env-file <root>/compose.env -f <root>/compose.yaml up -d --wait`。保留原镜像ID；回滚时换回该ID并重新 up。操作不替换业务镜像或数据库，不重新安装、不覆盖crontab。

停用看板时 `docker compose ... stop dashboard`；若要停用观察包装，在当前 crontab 中仅还原本看板添加的命令前缀，先备份当前 crontab，避免直接覆盖安装后其他任务改动。原始命令可从 crontab-before.txt 对照。所有数据保留，不删除目录或镜像。

## 密码与验证

在安全终端通过标准输入生成新 scrypt 哈希（apps/nas-dashboard/server/password.ts），原子更新 dashboard.env 中 DASHBOARD_PASSWORD_HASH，重新创建容器。重启后旧会话失效。登录会话180天，令牌哈希保存在独立auth目录、HttpOnly、SameSite=Strict；每IP15分钟最多8次失败，全局最多50次失败。当前为局域网HTTP；如接入HTTPS代理，需配置 DASHBOARD_SECURE_COOKIE=true 和正确的同源主机协议，不能直接开放公网。

验证桌面和手机宽度、筛选/分页/详情、脱敏与登录；核对真实数据库数量、费用和发送状态。只读隔离验证应在无业务写入的短窗口内，对数据库、WAL、durable/state和发送文件做前后哈希，查询调用数和账本行数。观察到并行业务任务时，应明确区分自然调度写入，不能归因于看板，也不能声称哈希不变。

安装器自 2.7.9 起为 `install.ts`：`--image` 必须是 `sha256:` digest，安装前校验镜像 digest、镜像内版本与源码版本一致、业务数据存在、调度 cron 存在；同名 compose 项目已被占用时拒绝安装。`--check` 可只校验不创建。

运行记录器自 2.7.8 起为 `record-run.ts`（宿主 Node 执行，`--disable-warning=ExperimentalWarning`），用法与 `record-run.py` 相同；Python 版保留为回退，两者输出字段与退出码一致（`test_record_run_ts.py` 对照）。

测试：`npm test --prefix apps/nas-dashboard`、`npm run build --prefix apps/nas-dashboard`、`python3 -m unittest discover -s deploy/dashboard -p 'test_*.py'`。


## 采集架构（2.7.16 起）

2.7.16 起正文采集并入看板 web 进程：`etn-dashboard-web` 单容器同时提供页面与采集，不再有独立 `body-collector`。采集只读挂载两个业务目录，唯一可写目录是看板自己的 `bodies/`，且不持有 dashboard.env、SMTP 或模型凭据；出口走 NAS 本机代理，不开放监听端口。

采集限流可用 `DASHBOARD_COLLECT_MAX`（默认 60）、`DASHBOARD_COLLECT_INTERVAL_MS`（默认 300000）、`DASHBOARD_COLLECT_BUDGET_MS`（默认 150000）在 `compose.env` 里调整，默认值与旧行为一致。

历史 v1.1 的独立 collector 容器与“回滚先停 collector”流程已废弃；回滚只需恢复 `compose.env` 的 `DASHBOARD_IMAGE` 与 `compose.yaml` 并 `up -d`。新抓取正文只供本地阅读，不进入旧业务选题、评分、发信或归档流程。

## Token 与费用（v1.4.0）

独立页面仅统计高级版，默认今日，支持近7天、本月及最多31天自定义区间。输入/输出只累加账本已知数值，缓存命中包含在输入中；缺失、损坏或无效用量显示未知。缓存命中率仅使用输入与缓存数据均有效的调用。费用使用历史cost，不按当前价格重算；cost未知时单独累计reserved，估算不代表账单实付。

`GET /api/usage`（需登录，只读）接收`from`、`to`、`stage`（generation/review/edition_review/unknown）、`status`、`q`、`page`。返回标准读取证据及data中的summary、daily、stages、statuses、items和分页字段；统计覆盖全部筛选结果。数量字段input/output/total/cache_hit的单位为Token，避免与凭据脱敏规则冲突。summary包含missing_usage/missing_input/missing_output/missing_cache与unknown_cost_calls；available=false时summary=null，不把读取异常当作零消耗。

重复调用按同一非空job完整历史的最小调用id判断；日期和其他筛选不改变首次记录。无job的旧记录标为无法判断。精确时间来自已保存的call_diagnostic，缺失时仅显示账本日期；失败原因复用已有受控诊断或validation_error。接口不返回原始提示、模型响应、任务全文或凭据。

## 2.7.12 起：超时与归档告警

- 运行记录器新增 `--timeout`（默认 600 秒），记录 `timeout_s` / `duration_ms` / `timed_out`；任务表按耗时排序展示，超时行标红。
- 概览新增「最近出刊成功」（只认 `delivery.completed` 的 `finished_at`）与「归档同步」；`archive_sync` 非 `synced` 或超过 36 小时未更新会进入告警列表。
