# 家庭代理规则修复记录

版本 `proxy-rules-20261019-1`，2026-10-19 21:28（上海时间）应用。此为 OpenSurge 网关策略版本，与新闻引擎版本独立；不触发新闻引擎升级。

## 修正

实际日志确认局域网设备到 Telegram 的 91.108.56.119、149.154.171.5 连接落入 MATCH/DIRECT 并超时。活动配置使用通信域名规则集，没有 Telegram IP 分流。

依据 [Telegram 官方地址段](https://core.telegram.org/resources/cidr.txt)，在私网规则之后加入 14 个 IPv4/IPv6 段，另加入 6 个明确的域名后缀，统一走海外服务。IP 规则带 no-resolve；国内直连、私网及其他既有分流保留。可审计的无密钥策略快照见 [proxy-policy.telegram.json](proxy-policy.telegram.json)。这是应用时快照，不宣称会自动追踪 Telegram 后续地址变更。

香港、新加坡、美国、日本、台湾组移除“总节点选择”候选，只保留订阅中过滤出的对应地区节点，修正规则中的单词边界转义，并通过核心 API 选中经过连通性检查的真实地区节点。原 AI/开发/游戏等上层选择保持，AI 实际仍走新加坡。

## 应用与回退

私有完整 profile、订阅、节点凭据及核心 API secret 始终只留在 NAS，不进入 Git。

宿主备份目录：`/vol3/1000/Docker/opensurge-local-20261019/config/rulefix-backup-20261019-212823`，包含原 config.yaml、profile.yaml、mihomo.yaml、selections.json 及 applied.json。新活动 profile 为同一 config/profiles 下的 `HomeLite-rulefix-20261019-212823.yaml`。

先以候选配置运行 `omg validate-mihomo`，确认生成的 DNS、TUN、provider 与原配置一致，再通过认证核心 API 的配置 payload 热重载。没有停止网关容器或修改家庭网关、DNS、IPv6 开关。

回退时恢复备份的网关配置和 runtime，用备份 runtime 内容通过配置 payload 热重载，再恢复 selections.json 中的选择。仅复制文件不会改变当前运行中的规则。核心的 path 重载受 SAFE_PATHS 限制，不能假定 `/var/lib/opensurge/mihomo.yaml` 可用于 path 参数；本次使用核心支持的 payload 方式。新规则及地区选择已写入持久配置和核心选择缓存。

## 验证与边界

- 配置校验通过；活动 API 中 Telegram IP 规则存在，地区组没有跨地区总选择回退。
- 91.108.56.119:443 与 149.154.171.5:443 经 SOCKS5 返回连接成功；日志显示命中 Telegram IP-CIDR 并走香港节点。
- Telegram 网页、X 返回 200，Google 连通性端点返回 204。
- ChatGPT 返回带 Cloudflare 验证的 403。规则已命中 AI 服务，不能将此状态描述为手机已恢复；iPhone App 实际验证待用户方便时进行。
