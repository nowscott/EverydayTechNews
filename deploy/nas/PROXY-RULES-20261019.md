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

## DNS 后续修正（21:37）

版本 `proxy-dns-20261019-2`。手机复测证明只修 Telegram IP 分流仍不足：其余海外连接仍有大量不含域名的原始 IP，X 的地址被默认直连。核心 DNS 查询同时将 www.google.com 返回为异常地址，x.com 查询一度失败。此前“飞牛 HTTP 代理可访问”不能替代真实手机端 DNS 路径验证。

把默认境外解析改为经海外服务组的 HTTPS DNS；国内/私网与节点域名单独使用国内 HTTPS DNS，节点解析独立以避免代理解析循环。保留 fake-IP 模式、局域网监听、IPv6 开关、TUN 和既有 Telegram/地区规则。可审计 DNS 片段见 [proxy-policy.dns.json](proxy-policy.dns.json)，语义依据 [mihomo DNS 文档](https://wiki.metacubex.one/config/dns/)。

私有备份目录：`/vol3/1000/Docker/opensurge-local-20261019/config/dnsfix-backup-20261019-213713`。持久 profile 为 `HomeLite-dnsfix-20261019-213713.yaml`，原配置及选择均有备份。配置验证通过后使用认证 API payload 热重载，回填原选择；未修改路由器 DHCP 或 NAS 系统 resolver。

验证：核心 DNS API 对 www.google.com、google.com、x.com 均查询成功；LAN 的 192.168.31.10:53 对 Google、X、百度均返回正常的 fake-IP 映射（198.18 网段是本配置预期行为）。手机后续需要明确使用 NAS DNS，而非只把 IPv4 网关指向 NAS；本次指导仅修改这台手机，整屋 DHCP DNS 待确认客户端效果后另行调整。手机端最终结果以用户复测及对应连接日志为准。

用户随后确认：手机 DNS 手动仅使用 NAS 并重连后，Google 与 X 均可访问。对应手机连接已包含正确域名，X 主站、API、图片和视频命中海外服务规则并有数据返回。这验证了客户端 DNS 路径是本次故障的关键环节；ChatGPT 网页与 App 继续单独验收，不因 Google/X 恢复而提前宣称通过。
