/**
 * 手动冒烟发信（TypeScript）：只读最新一期公开归档，只发给固定测试邮箱 OWNER。
 *
 * 不写账本、不占用正式投递状态、不受 06:30—09:00 投递窗口限制；用于人工确认版式、
 * 退订链接和 SMTP 链路。收件人写死为 OWNER，任何输入都不能改变它。
 */
import nodemailer from 'nodemailer';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectedItems, formatNews, buildMessage, notifications, unsubscribeLink } from './email.ts';
import { OWNER, validEmail, type Row } from './core.ts';

/** 最新一期有内容的公开归档（跳过空的 00.md）。 */
export function latestArchive(root: string): { path: string; markdown: string } {
  const archive = join(root, 'news_archive');
  if (!existsSync(archive)) throw new Error('archive_missing');
  const files = readdirSync(archive).filter((name) => /^\d{4}-\d\d$/.test(name)).sort().reverse()
    .flatMap((month) => readdirSync(join(archive, month))
      .filter((name) => /^\d\d\.md$/.test(name) && name !== '00.md').sort().reverse()
      .map((name) => ({ month, name })));
  for (const file of files) {
    const path = join(archive, file.month, file.name);
    const markdown = readFileSync(path, 'utf8');
    if (selectedItems(markdown).length) return { path, markdown };
  }
  throw new Error('ordinary_no_sendable_news');
}

export async function smokeSend(root: string, env: Row = process.env, send = true, transport?: any): Promise<Row> {
  if (send && env.ORDINARY_SMOKE_SEND !== 'YES') throw new Error('ordinary_smoke_confirmation_required');
  const archive = latestArchive(root);
  const items = selectedItems(archive.markdown);
  const [, year, month, day] = /(\d{4})-(\d{2})\/(\d{2})\.md$/.exec(archive.path)!;
  const date = `${year}年${month}月${day}日`;
  const sender = String(env.SENDING_ACCOUNT ?? '').trim();
  const base = String(env.APP_BASE_URL ?? '').trim();
  const secret = String(env.SUBSCRIPTION_CONFIRMATION_SECRET ?? '');
  if (send && (!validEmail(sender) || !env.SENDING_PASSWORD || !env.SERVER || !base.startsWith('https://') || !secret)) {
    throw new Error('ordinary_mail_configuration_missing');
  }
  const html = buildMessage('冒烟测试', formatNews(items), date, notifications(join(root, 'notifications.ini')),
    send ? unsubscribeLink(OWNER, base, secret, new Date()) : '');
  const subject = `【普通版手动测试】${date}科技早报样刊（${items.length}条）`;
  const result = { status: send ? 'sent' : 'rendered', to: OWNER, archive: archive.path, items: items.length, subject, html_bytes: html.length };
  if (!send) return result;
  const mailer = transport ?? nodemailer.createTransport({
    host: env.SERVER, port: 465, secure: true, auth: { user: sender, pass: env.SENDING_PASSWORD },
    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000, disableFileAccess: true, disableUrlAccess: true,
  });
  await mailer.sendMail({ from: sender, to: OWNER, subject, html });
  if (!transport) await mailer.close?.();
  return result;
}
