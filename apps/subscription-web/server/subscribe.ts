import type {
  ConfirmationMailer,
  ConfirmationLink,
  Subscriber,
  SubscriberRepository,
} from "./types.js";

export interface SubscribeDependencies {
  repository: SubscriberRepository;
  confirmationMailer: ConfirmationMailer;
  createConfirmationLink(email: string): ConfirmationLink;
}

export interface SubscribeResult {
  status: "pending" | "existing";
  message: string;
}

const inFlightSubscriptions = new Map<string, Promise<SubscribeResult>>();

export class ConfirmationDeliveryError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("确认邮件发送失败");
    this.name = "ConfirmationDeliveryError";
    this.cause = cause;
  }
}

async function createSubscriber(
  subscriber: Subscriber,
  dependencies: SubscribeDependencies,
): Promise<SubscribeResult> {
  const existing = await dependencies.repository.find(subscriber.email);
  if (
    existing &&
    existing.status !== "待确认" &&
    existing.status !== "已退订"
  ) {
    return {
      status: "existing",
      message: "这个邮箱已经在订阅列表中，无需重复提交。",
    };
  }

  if (!existing) {
    await dependencies.repository.createPending(subscriber);
  } else if (existing.status === "已退订") {
    await dependencies.repository.restorePending(existing.id, subscriber);
  }

  try {
    await dependencies.confirmationMailer.sendConfirmation(
      subscriber,
      dependencies.createConfirmationLink(subscriber.email),
    );
  } catch (error) {
    throw new ConfirmationDeliveryError(error);
  }

  return {
    status: "pending",
    message: "确认邮件已发送，请在 24 小时内点击邮件中的链接完成订阅。",
  };
}

export async function registerSubscriber(
  subscriber: Subscriber,
  dependencies: SubscribeDependencies,
): Promise<SubscribeResult> {
  const email = subscriber.email.trim().toLowerCase();
  const inFlight = inFlightSubscriptions.get(email);
  if (inFlight) {
    await inFlight;
    return {
      status: "pending",
      message: "确认邮件已发送，请在 24 小时内点击邮件中的链接完成订阅。",
    };
  }

  const operation = createSubscriber(
    { ...subscriber, email },
    dependencies,
  );
  inFlightSubscriptions.set(email, operation);

  try {
    return await operation;
  } finally {
    inFlightSubscriptions.delete(email);
  }
}
