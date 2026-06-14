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
- `APP_BASE_URL`：订阅网页的公开地址，本地开发使用 `http://localhost:5173`
- `SUBSCRIPTION_CONFIRMATION_SECRET`：确认令牌签名密钥，建议使用至少 32 字节的随机值
- `SENDING_ACCOUNT`、`SENDING_PASSWORD`、`SERVER`：向新订阅者发送确认邮件的 SMTP
- `SMTP_PORT`：可选，默认 `465`
- `NOTIFICATION_EMAIL`：可选，订阅者确认后接收站长侧的新订阅通知

Notion 数据源必须包含：

- `Name`：标题字段
- `Email`：邮箱字段
- `状态` 或 `Status`：选择或状态字段，并包含 `待确认`、`正常` 选项

新提交的邮箱先写入 `待确认`，确认邮件中的签名链接有效期为 24 小时。链接会打开独立的简洁确认页面，订阅者点击页面上的确认按钮后状态才更新为 `正常`，避免邮件安全扫描器误触发；同一令牌再次确认只会显示已使用。确认成功后会向订阅者另发一封成功邮件，并发送可选的站长通知。`待确认` 邮箱可以重新提交以获取新链接；已经为 `正常` 的邮箱不会重复发送确认邮件。

## Vercel 部署

在 Vercel 中将项目的 Root Directory 设置为 `apps/subscription-web`，并配置上述环境变量。构建命令和输出目录由 `vercel.json` 管理。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm audit
```
