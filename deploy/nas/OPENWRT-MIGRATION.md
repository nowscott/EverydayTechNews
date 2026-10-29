# NAS 新闻服务使用 OpenWrt

以下配置只涉及新闻服务；网关、DNS、OpenWrt 与停用旧代理由网络迁移流程单独验证。勿在 04:00—09:00 切换版本或控制器，不补发历史邮件。切换前确认 OpenWrt 虚拟机的上游仍为主路由，避免网关回环。

## 私有配置

透明分流已经从 NAS 及业务容器实际验证可用时，各文件中的代理项留空或移除，控制器不创建 `proxy.env`；否则使用 OpenWrt 的 HTTP 认证代理，将 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 放入下列文件中，权限均为 0600，目录权限 0700：

- 高级版业务：`/vol3/1000/Docker/everydaytechnews-test-20261019/deploy/nas/.env`。
- 普通版业务：`/vol3/1000/Docker/everydaytechnews-ordinary/ordinary.env`。
- 普通版归档发布：`/vol3/1000/Docker/everydaytechnews-ordinary/archive.env`。
- 高级版控制器：`/vol3/1000/Docker/everydaytechnews-managed/proxy.env`。
- 普通版控制器：`/vol3/1000/Docker/everydaytechnews-ordinary/managed/proxy.env`。
- 看板正文采集器：`/vol3/1000/Docker/everydaytechnews-dashboard/proxy.env`；透明分流时创建空文件。

每个代理变量单独一行、格式为 `KEY=value`；控制器文件仅允许上述三个键，不支持 shell 语法或引号。认证信息使用 HTTP 代理 URL 的 userinfo，用户名和密码的特殊字符先做 URL 百分号编码；不要把值写入仓库、命令参数、终端输出或聊天。`NO_PROXY` 至少包括 `localhost,127.0.0.1,::1`。控制器文件只由当前进程读取，并传给 Python、Git 和 Docker 构建，不写入构建参数的值或命令日志。Docker 守护进程拉取基础镜像还需自身可联网或使用已验证的本地基础镜像；容器内 SMTP 不经 HTTP 代理。

## 受控发布与升级

1. 先确认 OpenWrt 代理已验证可用、网络迁移期间的服务变更暂停已解除；验证 NAS 实际代理、DNS、Notion 鉴权、GitHub 和主要来源。记录当前代码、镜像、配置和调度，并备份上述文件。验证期间不触发采集、模型、邮件或归档写入；旧代理可在业务切换后再停用。
2. 在 09:00 之后协调控制器和业务切换；先暂停两个版本更新任务并等待当前业务及归档任务退出，保留原计划任务以便恢复。将私有设置和看板的 `snapshots`、`proxy.env` 准备好。不要让旧控制器先部署新版。
3. 在 main 对应提交的普通版、高级版及看板 CI 全部通过后发布各自的正式 Release。使用已验证正式版本源码运行普通版 `deploy/ordinary/install-managed.py --root /vol3/1000/Docker/everydaytechnews-ordinary --tag <普通版正式标签> --upgrade-controller`，以及高级版原有 `deploy/nas/install-managed.py --legacy <原部署根目录> --root /vol3/1000/Docker/everydaytechnews-managed --upgrade-controller`。控制器单独备份，升级检查正式标签、main 和 CI；控制器与账本均受现有锁保护。
4. 使用现有控制器逐项部署固定版本，先验证离线状态副本与发送账本；看板备份 Compose 和镜像配置后使用新 Compose 构建并启动两个服务。恢复原更新调度，确认版本、状态、权限、代理读取和正文采集器健康。服务更新失败只回退代码与配置，保留最新数据库、费用和发送账本。
5. 不主动重跑业务任务。下一次自然早报核对来源、内容、投递数量、未知和重复状态，人工确认收件单独记录。旧代理停用及重启后的网络、容器和来源连接由网络迁移流程验证。
