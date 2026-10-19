# OpenSurge 飞牛本机代理交接（2026-10-19）

范围：替换 NAS 登录终端与高级版新闻测试容器的显式代理。家庭设备、主路由 DHCP、NAS 默认网关与系统 resolver 不变。不宣称飞牛其他应用或 Docker daemon 已自动使用代理。

管理页面：`http://192.168.31.72:61767/enter`。仅供可信局域网，不映射公网。

NAS 部署目录：`/vol3/1000/Docker/opensurge-local-20261019`。配置与状态包含订阅和节点凭据，仅保存在 NAS 私有目录，不复制到代码仓库。

使用发布镜像标签 v0.1.1 对应的实际拉取摘要 `sha256:c290491f4e522175c8b3ccd6f47063e386983c8ab7ddedc8eec6fd5c83f725d0` 固定部署；镜像中的代理核心报告为 mihomo v1.19.27。配置不能仅依据仓库 tag 内容推断，启动参数与运行状态已在实机确认。

## 当前结构

- `opensurge-local` 使用独立 Docker bridge 网络 `172.30.91.0/24`，容器地址 `172.30.91.2`。
- OpenSurge 的 same_lan、DNS、TUN 与防火墙运行在容器网络命名空间内。DHCP 地址分配关闭，DNS 与 TUN 不发布到家庭 LAN。
- NAS 只导出回环代理端口 `127.0.0.1:17891`，映射到容器 7890；管理页面仅绑定 NAS LAN 地址 61767。
- 为按官方流程启停容器内网络组件，容器具有 NET_ADMIN、NET_RAW、SYS_ADMIN，并允许其容器内 mount 操作；未使用 host 网络、privileged、Docker socket 或宿主根目录挂载。
- 订阅沿用此前已验证的私有 provider 配置，每日刷新与节点故障切换保留。
- `restart: unless-stopped`，禁用 Watchtower 自动更新。

当前是仅提供显式代理的隔离部署，不是全屋旁路由。以后全屋接入时需重新规划 host 网络、网卡、DNS、IPv6、恢复与真实设备验证，不能把这份配置直接用于家庭网关。

## 验证

- OpenSurge 配置校验、核心启动、状态 running，容器内 TUN ready。
- Web `/enter` 返回 200，带会话访问 overview 返回 200。
- `provider-update` 成功；重启 OpenSurge 后自动恢复，GitHub feed 仍返回 200。
- 新闻测试容器经新端口采集成功 15/16；Tesla 403 保留为来源拒绝访问，不绕过。
- 模型调用账本为 0，没有发信。试刊与 NAS_TRIAL_ENABLED 开关不变，Actions 未切换。
- NAS 默认网关、IPv4 forwarding 值与 `/etc/resolv.conf` 内容均与部署前一致。
- 未运行 `make lab-test` / `make lab-test-tun`，本次仅验证隔离容器内的本机显式代理和真实来源采集，不作家庭网络/DHCP/下游设备路径验收结论。

## 切换与清理

`~/.config/nas-news-proxy/env.sh` 已改用 17891，修改前副本是同目录 `env.sh.before-opensurge-20261019`。新闻容器使用本项目 `compose.proxy.yaml`，默认代理端口也改为 17891。

临时 `nas-news-proxy` 已停止，原目录保留用于回退；没有自动删除其私有数据。

用户明确要求卸载的旧 v2rayA：已删除容器、mzz2017/v2raya 专用镜像、`/vol3/1000/Docker/v2raya` 下 Compose 与配置数据。

回退时先启动原 `nas-news-proxy`，将用户环境与新闻覆盖配置改回端口 17890并验证，再停止 OpenSurge；不改动新闻的费用或发送账本。
