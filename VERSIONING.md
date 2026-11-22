# 版本号口径

本仓库有多个独立组件，各自维护语义化版本（SemVer）。为避免"GitHub 一个号、Docker 一个号"，规定**一个组件版本只有一个编号**，在五处完全一致。

## 组件与编号

| 组件 | 版本前缀 | 说明 | GitHub Latest |
|---|---|---|---|
| 普通版出刊 | `ordinary-news-v` | 线上正式产品，NAS 部署 | 是（唯一） |
| 高级版引擎 | `news-engine-v` | 内部实验，非公开产品；**版本号与普通版统一到同一数字**（tag 前缀各自独立） | 否（`--latest=false`） |
| NAS 工作台 | `nas-dashboard-v` | 局域网只读看板 | 否 |
| 旧 Python 应用 | `v1.x` / `v2.x` | 已冻结，仅归档，不再发版 | 否 |

普通版版本号与 `v2.x`、`news-engine-v0.x` 相互独立，升级互不影响。

## 一个版本号的五处落点

以 `ordinary-news-v1.1.0` 为例：

| 落点 | 值 | 位置 |
|---|---|---|
| 版本源 | `1.1.0` | `deploy/ordinary/release.json` → `version`（**唯一事实来源**） |
| 包版本 | `1.1.0` | `packages/ordinary-news/package.json` → `version`（及 `package-lock.json`） |
| 更新日志 | `## ordinary-news-v1.1.0` | `CHANGELOG.md` |
| git tag / GitHub Release | `ordinary-news-v1.1.0` | 仓库 tag 与 Release 的 `tag_name` 与 `name` 一致 |
| Docker 镜像 | `everyday-tech-news-ordinary:ordinary-news-v1.1.0` | NAS 构建产物 |

部署成功后，`deployment.json` 的 `active.tag` 与 `active.image_tag` 也必须是这两个值；镜像摘要 `active.image` 记录 `sha256:…`，提交 `active.sha` 记录 40 位 commit。

## 规则

1. **不再生成 `git-<sha>` 镜像别名**。提交号只写进 OCI label（`org.opencontainers.image.revision`）与 `deployment.json` 的 `sha` 字段，避免同一个镜像有两套名字、清理时漏删。
2. 组件版本不得跳号，不得回退；`release.json` 的 `state_schema` / `controller_protocol` 单独演进，不并入版本号。
3. Release 标题只写版本号或简短主题，不写日期；`--latest=false` 仅用于 `news-engine-v*`、`nas-dashboard-v*`，普通版发布应设为 Latest，让仓库首页指向真正在跑的版本。
4. `CHANGELOG.md` 每个版本一个二级标题，标题里的编号必须与 tag 一致。
5. 预发布用 `ordinary-news-vX.Y.Z-rc.N`，NAS 只部署非预发布版本。

## 发版步骤

```sh
# 1. 改版本源（三处必须同步；脚本会校验）
#    deploy/ordinary/release.json、packages/ordinary-news/package.json、CHANGELOG.md
npm ci --prefix packages/ordinary-news
node scripts/check-version.mjs            # 不一致会直接失败
git commit -am "chore(version): ordinary-news-v1.1.0"
git tag -s ordinary-news-v1.1.0 -m ordinary-news-v1.1.0
git push origin main --follow-tags
# 2. 在 GitHub 创建 Release（普通版设为 Latest）
# 3. NAS 部署：python3 deploy/ordinary/install-managed.py --root … --tag ordinary-news-v1.1.0
```

CI（`.github/workflows/ordinary-news.yml`）会在 PR 与 main 上运行 `check-version.mjs`，版本源、包版本与 CHANGELOG 标题任一不一致即失败。

## 现状（2026-11-22）

- 当前版本：`2.7.17`。三处同号：普通版 `ordinary-news-v2.7.17`、看板 `nas-dashboard-v2.7.17`、高级版引擎 `news-engine-v2.7.17`（tag 前缀各自独立，数字必须一致）
- 版本线切换：旧 `1.0.x` 系列就此终止；`v1.x` / `v2.0–2.6` 的旧 Python 实现仍为冻结归档，不再发版
- Docker 侧 `:git-<sha>` 别名自本版起不再生成；旧别名随部署清理
- GitHub 的 Latest 指向 `ordinary-news-v2.7.0`（发布时设置），不再停留在 `v2.6.4`
