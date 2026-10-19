# News engine · TypeScript 高级订阅引擎

高级订阅的完整处理链路，Node.js 24 可直接运行 `.ts`。评分子模块保持零运行时第三方依赖；完整链路使用固定版本的 fast-xml-parser、Cheerio、Nodemailer 和 tar。Python 保留为离线对照与兼容参考，普通订阅仍运行原有实现。

## 完整内测入口

```sh
node packages/news-engine/src/main.ts init --data /tmp/premium-offline
node packages/news-engine/src/main.ts status --data /tmp/premium-offline
```

权威状态在私有数据仓库。正式内测入口为 `run --data state --sync-git`，Linux 使用与旧任务一致的 `flock` 和工作流并发组；`run` 默认仅维护，只有显式 `--maintenance-only false` 才处理到期的生成/投递。`--launch true` 创建一次固定候选、固定30分钟期限的TS验收样稿；重跑不延长、不换期、不自动重发。`--verify-api true` 仅验证单篇，不发邮件。三个布尔参数必须明确为 `true/false`，不能同时选择两种验收模式。`--sample-revision serif` 为本次明确请求的衬线版加刊，具有独立冻结输入及投递记录，不覆盖初次诊断。

标题与正文采用中文宋体/衬线字体栈，按客户端可用字体回退，不远程加载字体。补足时优先复用过去24小时内、合格且未实际投递的模型结果；只有展示文章的简报才消耗选题，诊断不消耗。每日100名额统计不同的新格式文章版本，缓存复用不占新增名额，修复仍计费用与每篇3次尝试。选题候选池与每日新版本额度分别处理，避免早期候选截断让后续完成内容无法组稿。

私有工作流使用 `experiments/premium/private-workflow-ts.yml.template` 并固定完整引擎SHA。仅允许 `nowscott@qq.com`，沿用2026-10-19至25日七天试刊，10月26日00:00上海时间停止新增模型和发送；每日最多2元、100个新格式文章版本、每批4次请求，旧费用与未知预留照常计入。正文不足15条发诊断，模型初稿仍待人工核对。维护、过期清理和日桶归档在内测到期后继续。

`collect/assess/enrich/compose/deliver/reconcile/status/report/archive/restore-artifact/ack-artifact` 均有对应TS命令；`fresh-sample` 是 `launch-sample` 的别名，`send-sample` 只发送已冻结TS验收期。历史导入、历史预览保留为离线Python参考，不是上线运行链路。

状态格式继续为schema_version=1，SQLite可重建；提示词、哈希、缓存和账本不重置。未知费用、未知SMTP结果、Git推送失败均不会自动重放外部动作。任何回退都必须保留TS之后的新账本与发送记录。

## 定时运行的边界

Actions按计划唤起，执行后退出，并不是常驻服务。平时计划每小时15/25/45/55分检查；上海05:02～06:57增加每5分钟唤起机会。GitHub定时可能延迟或丢失，增加检查不能承诺06:30准点。

定时写作只在05:00～06:12接收新请求，唯一付费入口在请求前后复核；定时任务不能使用人工验收的anytime许可。06:00采集截止，06:15生成截止，06:30～07:00允许投递。任务晚到时可从原截止前证据冻结结果并记录漏发，07:00后不会自动发信；GitHub摘要和警告明确区分任务成功与邮件成功。当天漏发不计正常出刊，也不自动延长七天试刊。

## 普通版过滤与统一领域

普通版与TS共用`config/news-filter.json`：原关键词与金额规则不变，标题在候选筛选、付费入口和缓存组稿时重复核对。命中关键词、价格和领域容量均保存具体排除原因。

领域统一为人工智能、芯片与计算硬件、软件与开发、安全与网络、汽车与机器人、航天与科学、消费电子、科技产业8类；品牌仍是兴趣标签，不再另作领域。每期同领域最多4条，前5条重点同领域最多2条；缺少合格领域时允许不足条数，不降低分数或证据要求凑稿。生成阶段遇到该领域已有4篇合格缓存，会优先处理其他领域，避免为无法入选的同类文章继续付费。

HN采用[官方API](https://github.com/HackerNews/API)的热门60与最新40投稿去重扫描，详情并发5、正文并发2，每批最多12次白名单正文请求，90秒后不再发起来源请求。只读取投稿，不采评论树。允许发布方的HTML须有独立文章区域、对应规范链接和明确含时区的原始发布时间；不能确认则仍为发现线索，不用投稿时间顶替。Show HN提供的完整原创投稿正文可独立作为“项目投稿自述”，链接指向HN讨论页，保留外链元数据且不宣称核实产品效果。403、重定向、付费墙均不绕过。

## 安装与验证

以下命令从仓库根目录执行：

```sh
npm ci --prefix packages/news-engine --ignore-scripts --no-audit --no-fund
npm run typecheck --prefix packages/news-engine
npm test --prefix packages/news-engine
.venv/bin/python -m unittest discover -s tests -v
```

开发检查使用 TypeScript 和 Node 类型声明。完整跨语言对照需先安装根目录 `requirements.txt`；仅评分对照只需要Python标准库。默认优先使用根目录 `.venv/bin/python`，不存在则使用 `python3`，也可通过 `PYTHON` 指定解释器。独立 CI 在 Node 24 / Python 3.14 上执行类型、故障恢复及对照检查。部署验证与工作流证据见迁移记录。

## 接口

```ts
import { evaluate, choose, preferences } from './packages/news-engine/src/ranking.ts';

const config = preferences(); // 每次处理固定同一份配置，读取现有 editorial.json。
const score = evaluate(article, '2026-10-18T12:00:00+08:00', config);
const [selected, rejected] = choose(articles, '2026-10-18T12:00:00+08:00', config, {
  sample: false,
  target: 32,
});
```

输入必须已完成采集、时效筛选、正文可用性判断和事件去重；本模块**不替代** `brief.select` 或 `pool.candidates`。评分会计算旧新闻衰减，但不会独立执行24小时排除规则，也不判定证据是否过期。文章必须包含 `id/title/text/source/published_at`，可携带 `content_status/topic` 及其他字段。`choose` 返回文章副本，不修改输入；Python 原实现会修改输入，这是有意的接口差异，序列化输出保持一致。

当前评分版本为 `editorial-4.4`（补充英文编译器、解析器、固件等技术词），与Python参考保持一致。`evaluate` 返回评分结构；`choose` 返回 `[selected, rejected]`，含配置、评分明细、兴趣、信号、选择顺序和排除原因。未指定 `target` 或指定零时使用配置的 `edition_maximum`，与 Python 一致。截止时间为必填，日期要求带时区，最多六位小数秒；非法输入报错，不读取本机时区或当前时间。

## JSON 命令入口

```sh
node packages/news-engine/src/cli.ts input.json
# 或：cat input.json | node packages/news-engine/src/cli.ts -
```

输入例子：

```json
{
  "operation": "choose",
  "cutoff": "2026-10-18T12:00:00+08:00",
  "sample": false,
  "target": 32,
  "articles": [{
    "id": "example-1",
    "title": "大模型测试版本发布",
    "text": "公司宣布开始测试新模型，尚未正式上线。",
    "source": "github",
    "published_at": "2026-10-18T04:00:00+08:00",
    "content_status": "usable_excerpt",
    "topic": "AI"
  }]
}
```

`operation` 默认为 `choose`，输出 `{selected,rejected}`；`evaluate` 输出 `{rankings}`。可传 `config` 覆盖默认配置。上述短正文仅演示接口，不能作为采集正文合格样本。标准输出仅含 JSON，失败以非零状态退出并将错误写入标准错误。

## 离线性能对照

```sh
node packages/news-engine/tools/benchmark.ts --output /tmp/ranking-benchmark.json
```

自动验证合成408篇和10000篇输入的 Python/TS 完整输出，再分别测试原 Python、配置加载一次的 Python、TS。每种实现三个新进程，每进程一次预热、五次计时；相邻轮交替顺序。读取输入及复制数据不计入热运行时间。另测空进程启动、包含输入/导入/计算/输出的冷调用和进程峰值 RSS，互不相加。Python 冷调用经过参考脚本，TS 冷调用经过 CLI，属于工具链对照，并非解释器启动的纯语言结论。

有本地私有证据时，可从已冻结且已筛选的期刊导出文章；导出会验证正文哈希和到期时间，不打开可写数据库，不修改正文保留期：

```sh
.venv/bin/python packages/news-engine/tools/export_local_sample.py \
  --state-root premium_data/pool --issue sample-current-2026-10-18 \
  --output premium_data/performance/ts-ranking-private-input.json
node packages/news-engine/tools/benchmark.ts \
  --input premium_data/performance/ts-ranking-private-input.json \
  --output premium_data/performance/ts-ranking-benchmark.json
```

导出文件含正文，仅保存在被忽略的私有路径，验证后删除；不得上传 Git。基准报告只包含数量、时间、环境和内存，不包含正文、标题、文章标识或原始路径。旧证据到期后必须换用新的合格样本，不能永久保存派生全文以绕过90天保留期。

第一批评分测速见 [PERFORMANCE.md](PERFORMANCE.md)，完整迁移与部署进度见 [MIGRATION.md](MIGRATION.md)。完整链路没有预设提速倍数。
