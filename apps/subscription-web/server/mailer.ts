import nodemailer from "nodemailer";
import type {
  ConfirmationMailer,
  OwnerNotifier,
  Subscriber,
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
        confirmationUrl: string,
      ) {
        await transporter.sendMail({
          from: sender,
          to: subscriber.email,
          subject: "每日科技早报：请确认你的订阅",
          text: [
            `${subscriber.name}，你好：`,
            "",
            "请点击下面的链接确认订阅每日科技早报：",
            confirmationUrl,
            "",
            "链接将在 24 小时后失效，并且只能确认一次。",
            "如果这不是你的操作，可以忽略这封邮件。",
          ].join("\n"),
          html: `
            <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#172126;line-height:1.7">
              <p>${escapeHtml(subscriber.name)}，你好：</p>
              <p>请确认订阅每日科技早报。确认后，后续早报将发送到这个邮箱。</p>
              <p style="margin:28px 0">
                <a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;background:#bd4f32;color:#fffaf1;text-decoration:none;padding:12px 20px;font-weight:700">确认订阅</a>
              </p>
              <p style="font-size:13px;color:#637078">链接将在 24 小时后失效，并且只能确认一次。如果这不是你的操作，可以忽略这封邮件。</p>
            </div>
          `.trim(),
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
