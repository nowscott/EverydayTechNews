import nodemailer from "nodemailer";
import type {
  ConfirmationMailer,
  ConfirmationLink,
  OwnerNotifier,
  Subscriber,
  SuccessMailer,
} from "./types.js";

interface MailEnvironment {
  SENDING_ACCOUNT?: string;
  SENDING_PASSWORD?: string;
  SERVER?: string;
  SMTP_PORT?: string;
  NOTIFICATION_EMAIL?: string;
}

interface SubscriptionMailers {
  confirmationMailer: ConfirmationMailer;
  successMailer: SuccessMailer;
  ownerNotifier: OwnerNotifier | null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatShanghaiTime(value: Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}年${part("month")}月${part("day")}日 ${part("hour")}:${part("minute")}`;
}

function buildSubscriberEmail(content: string) {
  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
          @media only screen and (max-width: 520px) {
            .email-shell { padding: 0 !important; }
            .email-card { border-left: 0 !important; border-right: 0 !important; }
            .email-content { padding: 26px 22px !important; }
            .email-button { display: block !important; text-align: center !important; }
          }
        </style>
      </head>
      <body style="margin:0;padding:0;background:#ece9e0;color:#172126;-webkit-text-size-adjust:100%;text-size-adjust:100%">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#ece9e0">
          <tr>
            <td align="center" class="email-shell" style="padding:28px 12px">
              <table role="presentation" width="560" cellspacing="0" cellpadding="0" class="email-card" style="width:100%;max-width:560px;border-collapse:collapse;border:1px solid #d1d8d4;background:#fffef9">
                <tr>
                  <td class="email-content" style="padding:34px 36px;border-top:5px solid #bd4f32;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#172126;font-size:15px;line-height:1.75">
                    <p style="margin:0 0 22px;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:2px;color:#bd4f32">EVERYDAY TECH NEWS</p>
                    ${content}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();
}

export function createSubscriptionMailers(
  environment: MailEnvironment = process.env,
): SubscriptionMailers {
  const sender = environment.SENDING_ACCOUNT?.trim();
  const password = environment.SENDING_PASSWORD?.trim();
  const server = environment.SERVER?.trim();
  const owner = environment.NOTIFICATION_EMAIL?.trim();

  if (!sender || !password || !server) {
    throw new Error("SMTP 环境变量不完整");
  }

  const port = Number(environment.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host: server,
    port,
    secure: port === 465,
    auth: {
      user: sender,
      pass: password,
    },
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });

  return {
    confirmationMailer: {
      async sendConfirmation(
        subscriber: Subscriber,
        confirmationLink: ConfirmationLink,
      ) {
        const expiresAt = `${formatShanghaiTime(confirmationLink.expiresAt)}（北京时间）`;
        await transporter.sendMail({
          from: sender,
          to: subscriber.email,
          subject: "每日科技早报：请确认你的订阅",
          text: [
            `${subscriber.name}，你好：`,
            "",
            "请点击下面的链接确认订阅每日科技早报：",
            confirmationLink.url,
            "",
            `链接失效时间：${expiresAt}`,
            "链接只能确认一次。",
            "如果这不是你的操作，可以忽略这封邮件。",
          ].join("\n"),
          html: buildSubscriberEmail(`
            <h1 style="margin:0;font-size:26px;line-height:1.3">确认邮件订阅</h1>
            <p style="margin:20px 0 0">${escapeHtml(subscriber.name)}，你好：</p>
            <p style="margin:10px 0 0">请确认订阅每日科技早报。确认后，后续早报将发送到这个邮箱。</p>
            <p style="margin:26px 0">
              <a href="${escapeHtml(confirmationLink.url)}" class="email-button" style="display:inline-block;box-sizing:border-box;background:#bd4f32;color:#fffaf1;text-decoration:none;padding:13px 22px;font-weight:700">确认订阅</a>
            </p>
            <p style="margin:0;font-size:13px;color:#637078">链接失效时间：${escapeHtml(expiresAt)}。链接只能确认一次。如果这不是你的操作，可以忽略这封邮件。</p>
          `),
        });
      },
    },
    successMailer: {
      async sendSuccess(subscriber: Subscriber) {
        await transporter.sendMail({
          from: sender,
          to: subscriber.email,
          subject: "每日科技早报：订阅成功",
          text: [
            `${subscriber.name}，你好：`,
            "",
            "你的邮箱已经确认，现已成功订阅每日科技早报。",
            "下一期早报将发送到这个邮箱。",
            "",
            "感谢订阅。",
          ].join("\n"),
          html: buildSubscriberEmail(`
            <h1 style="margin:0;font-size:26px;line-height:1.3">订阅成功</h1>
            <p style="margin:20px 0 0">${escapeHtml(subscriber.name)}，你好：</p>
            <p style="margin:10px 0 0">你的邮箱已经确认，现已成功订阅每日科技早报。</p>
            <p style="margin:10px 0 0">下一期早报将发送到这个邮箱。</p>
            <p style="margin:24px 0 0;font-size:13px;color:#637078">感谢订阅。</p>
          `),
        });
      },
    },
    ownerNotifier: owner
      ? {
          async notifyOwner(subscriber: Subscriber) {
            await transporter.sendMail({
              from: sender,
              to: owner,
              subject: "每日科技早报：新订阅通知",
              text: [
                "一位订阅者已完成邮箱确认：",
                "",
                `称呼：${subscriber.name}`,
                `邮箱：${subscriber.email}`,
              ].join("\n"),
            });
          },
        }
      : null,
  };
}
