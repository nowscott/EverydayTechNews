# 2026-10-19 飞牛测试环境验证

部署位置：`/vol3/1000/Docker/everydaytechnews-test-20261019`，状态目录为该目录下 `deploy/nas/data`。这是独立空白验证环境，未导入现有内测账本，未接管调度。

宿主：x86_64，用户 1000、组 1001，Docker Compose 2.40.3。业务代码来源提交 `a83c975db93e155355eb35e40a0d73bffc682aec`，另外包含本次尚未提交的部署文件。当前私有 Actions 固定引擎为 `416532745cbb62ad4152506f74a13b5db9d071ec`，真正接管前需统一所用版本并记录差异。

基础镜像：官方 Node 24 bookworm slim 的 amd64 manifest `sha256:ec857ea6bb60cb3d0fa4d97495590c5fe7d51be8572c307b55957eeb06569cf7`。NAS 镜像加速源返回 401，直接拉取也失败，因此通过 Mac 下载并验证 blob SHA-256 后导入。构建下载临时经 Mac 代理完成，未改变 NAS 全局 Docker 配置；运行容器未配置该代理。

实机通过：

- 非 root 用户启动，持久目录权限、只读根文件系统、临时目录可用。
- init、status、archive、report 正常结束。
- 临时独立状态的 checkpoint → archive → 重新打开恢复成功。
- 未启用时 run 以退出码 2 拒绝执行。
- maintenance 正常退出，模型调用账本为空，未配置 SMTP 和模型密钥。
- 真实采集 16 个来源，2 个成功：IT之家 60 条可用内容，Apple Newsroom 20 条发现线索；其余 14 个来源连接或解析失败，暂不具备完整来源覆盖。

本地类型检查及 48 项既有单元测试已在准备部署时通过。现有备份、共享文件、其他容器和 Actions 调度未改动。没有进行付费请求或邮件投递。

接管前仍需：

1. 解决 NAS 的来源访问问题。已有本地代理端口的 GitHub feed 访问测试未成功，不能将依赖 Mac 的临时网络作为无人值守方案。
2. 安全配置原内测的模型、Notion 和 SMTP 密钥。GitHub Secrets 无法直接读回；不要将明文密钥发到聊天或写入仓库。
3. 停止并排空 Actions，迁入最终账本与全部未过期正文，核对费用与发送记录。
4. 完成单收件人端到端验证和 NAS 定时调度验证后再启用，保留原试刊截止时间。

当前没有配置计划任务，`NAS_TRIAL_ENABLED=false`，容器按一次性任务退出；飞牛界面没有常驻容器属于预期行为。

## 同日追加：NAS 独立代理验证

根据用户授权的新订阅，部署独立 `nas-news-proxy` 服务（mihomo v1.19.32，官方 GitHub release 的 amd64 compatible 二进制，下载摘要已验证）。复用已有 alpine:3.22 镜像，设置 unless-stopped，禁止 Watchtower 自动更新。

私有配置目录：`/vol3/1000/Docker/nas-news-proxy-20261019`，仅 NAS 用户可读，含订阅地址与节点凭据，不同步到代码仓库。混合代理监听 `127.0.0.1:17890`，管理接口仅本机监听且需要随机密钥。订阅每日更新，区域节点自动故障切换。原 v2rayA 容器与配置未修改。

用户登录 Shell 已通过 `~/.config/nas-news-proxy/env.sh` 配置 HTTP/HTTPS 代理并在 `~/.profile` 引入；原 profile 有日期备份。高级版通过 compose.proxy.yaml 使用同一 NAS 代理。

实测：

- NAS 请求 GitHub feed 返回 200；Docker 官方 registry 返回预期的未认证 401，表明网络可达。
- 通过本机管理接口触发订阅更新返回 204，验证 NAS 独立更新成功。
- 新闻 maintenance 再次正常结束，来源成功率从 2/16 提升到 15/16。Tesla 返回 403，未绕过站点限制。
- 15 个成功来源代表抓取成功，部分内容仍是发现线索，不代表全部可用于生成。
- 模型调用账本仍为 0，邮件与付费开关仍关闭，没有迁移正式内测状态或变更 Actions。

NAS Docker 后台的镜像加速源/daemon 代理配置尚未修改；终端代理变量不会自动影响 Docker daemon。没有重启 Docker，也没有影响其他容器。之前“来源网络未解决”的结论已被本节复测结果更新；密钥配置与最终状态交接仍待完成。

关闭用户终端代理可移除 profile 中标注的引入段；新闻容器停用代理可不加载 compose.proxy.yaml。独立代理服务可在其目录执行 `docker compose stop`，不需要删除任何订阅或原服务文件。
