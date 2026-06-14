# Subscription Web

每日科技早报的订阅页面和订阅 API，使用 React、TypeScript、Tailwind CSS 和 Vite 构建。

生产地址：https://mailist.nowscott.top/

## 本地运行

```bash
npm install
npm run dev
```

- 页面：http://localhost:5173
- 本地 API：http://127.0.0.1:3001

开发服务器会先读取仓库根目录的 `.env`，再使用当前目录的 `.env.local` 覆盖同名变量。

## 环境变量

复制 `.env.example` 并配置：

- `NOTION_API_KEY`：Notion 集成密钥
- `NOTION_DATABASE_ID`：订阅数据库 ID
- `NOTION_DATA_SOURCE_ID`：可选，直接指定 data source ID
- `SENDING_ACCOUNT`、`SENDING_PASSWORD`、`SERVER`：新订阅通知 SMTP
- `SMTP_PORT`：可选，默认 `465`
- `NOTIFICATION_EMAIL`：可选，接收新订阅通知的邮箱

Notion 数据源必须包含：

- `Name`：标题字段
- `Email`：邮箱字段
- `状态` 或 `Status`：选择或状态字段，并包含 `正常` 选项

## Vercel 部署

在 Vercel 中将项目的 Root Directory 设置为 `apps/subscription-web`，并配置上述环境变量。构建命令和输出目录由 `vercel.json` 管理。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm audit
```
