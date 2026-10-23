# NAS 看板部署与维护

## 首次安装

1. 在 NAS 上准备本版本源码，构建固定镜像：`docker build -f deploy/dashboard/Dockerfile -t everyday-tech-news-dashboard:1.0.0 .`。如使用已验证的本地 Node 24 镜像，传 `--build-arg NODE_IMAGE=<已核对镜像ID的本地标签>`；构建前后确认该标签的镜像ID不变，记录基础镜像ID和最终镜像ID。镜像不含业务状态、SMTP/模型密钥或管理密码。
2. 用镜像ID安装：`python3 deploy/dashboard/install.py --root /vol3/1000/Docker/everydaytechnews-dashboard --image sha256:... --bind 192.168.31.10 --source-commit <源码版本与构建归档SHA256>`。默认3080端口，冲突时安装在修改前退出，可指定 `--port`。安装目录必须不存在。
3. 安装器读取两个控制器配置来确定数据位置，但不把这些配置复制给网页。Compose只读挂载业务目录、看板运行记录和仅含版本信息的部署投影。网页密码哈希独立生成，不读取业务环境文件。
4. 先启动并等待看板健康，再给现有三条 run 调度命令加观察包装。其余 update、sync、health 调度保持原样；不立即执行任何业务任务。原 crontab 完整保存在看板目录 crontab-before.txt；观察记录在下一次自然调度出现。
5. 初始密码在看板目录 initial-password.txt，权限0600；dashboard.env仅含哈希。用户用局域网地址登录。安装器仅打印密码文件位置，不打印密码。

数据目录0700、业务文件0600，容器以现有NAS UID/GID读取。根文件系统只读，无 Docker socket，无 host 网络，只在指定NAS局域网IPv4绑定端口；restart=unless-stopped，healthcheck每30秒一次。CPU上限1核，内存512MB，临时文件系统256MB用于一致性查询副本和SQLite临时排序。

## 调度观察

record-run.py 用独立的非阻塞锁避免重叠，原业务锁仍保留。开始/结束/退出码原子写入看板自己的runtime目录。杀死观察器造成的旧running记录在45分钟后显示未知；不接管、恢复或重试业务。观察器文件、配置和运行记录不得放入受发布控制器完整性检查的业务源码目录。

运行记录不含命令参数、密钥或业务stdout。每个任务一个文件，长期保留，不自动删除；接口只按所选日期读取、分页返回。控制器版本变动会在下一轮自然任务时刷新脱敏部署投影；版本投影失败清空身份，不沿用旧版本冒充当前版本。

## 更新与回滚

构建、验证新镜像后，备份 compose.env、dashboard.env 和 installation.json 到独立的带时间戳目录。仅修改 compose.env 中的 DASHBOARD_IMAGE，再执行 `docker compose --env-file <root>/compose.env -f <root>/compose.yaml up -d --wait`。保留原镜像ID；回滚时换回该ID并重新 up。操作不替换业务镜像或数据库，不重新安装、不覆盖crontab。

停用看板时 `docker compose ... stop dashboard`；若要停用观察包装，在当前 crontab 中仅还原本看板添加的命令前缀，先备份当前 crontab，避免直接覆盖安装后其他任务改动。原始命令可从 crontab-before.txt 对照。所有数据保留，不删除目录或镜像。

## 密码与验证

在安全终端通过标准输入生成新 scrypt 哈希（apps/nas-dashboard/server/password.ts），原子更新 dashboard.env 中 DASHBOARD_PASSWORD_HASH，重新创建容器。重启后旧会话失效。登录会话8小时、HttpOnly、SameSite=Strict；每IP15分钟最多8次失败，全局最多50次失败。当前为局域网HTTP；如接入HTTPS代理，需配置 DASHBOARD_SECURE_COOKIE=true 和正确的同源主机协议，不能直接开放公网。

验证桌面和手机宽度、筛选/分页/详情、脱敏与登录；核对真实数据库数量、费用和发送状态。只读隔离验证应在无业务写入的短窗口内，对数据库、WAL、durable/state和发送文件做前后哈希，查询调用数和账本行数。观察到并行业务任务时，应明确区分自然调度写入，不能归因于看板，也不能声称哈希不变。

测试：`npm test --prefix apps/nas-dashboard`、`npm run build --prefix apps/nas-dashboard`、`python3 -m unittest discover -s deploy/dashboard -p 'test_*.py'`。


## 从v1.0升级到v1.1

备份当前compose.yaml、compose.env、installation.json。新建看板目录下bodies（0700、与业务相同UID），构建v1.1镜像后替换DASHBOARD_IMAGE并使用新compose.yaml执行up -d --wait。新增body-collector只读挂载两个业务目录，唯一可写挂载为看板自己的bodies；它无dashboard.env、SMTP或模型凭据。collector使用既有NAS本机7890代理访问固定允许的新闻发布方，host网络不开放监听端口。网页进程仍只读挂载全部业务与正文缓存。

回滚到v1.0时先停止body-collector，再恢复备份的compose.yaml与镜像配置；保留bodies目录和既有业务状态。新抓取的正文只供本地阅读，不进入旧业务的选题、评分、发信或归档发布流程。
