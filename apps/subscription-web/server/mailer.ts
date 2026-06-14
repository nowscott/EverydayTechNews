import nodemailer from "nodemailer";
import type { Subscriber, SubscriptionNotifier } from "./types.js";

interface MailEnvironment {
  SENDING_ACCOUNT?: string;
  SENDING_PASSWORD?: string;
  SERVER?: string;
  SMTP_PORT?: string;
  NOTIFICATION_EMAIL?: string;
}

export function createSubscriptionNotifier(
  environment: MailEnvironment = process.env,
): SubscriptionNotifier | null {
  const receiver = environment.NOTIFICATION_EMAIL?.trim();
  if (!receiver) return null;

  const sender = environment.SENDING_ACCOUNT?.trim();
  const password = environment.SENDING_PASSWORD?.trim();
  const server = environment.SERVER?.trim();
  if (!sender || !password || !server) {
    throw new Error("已配置 NOTIFICATION_EMAIL，但 SMTP 环境变量不完整");
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
    async notify(subscriber: Subscriber) {
      await transporter.sendMail({
        from: sender,
        to: receiver,
        subject: "每日科技早报：新订阅通知",
        text: [
          "收到一位新的邮件订阅者：",
          "",
          `称呼：${subscriber.name}`,
          `邮箱：${subscriber.email}`,
        ].join("\n"),
      });
    },
  };
}
