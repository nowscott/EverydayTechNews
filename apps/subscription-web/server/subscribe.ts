import type {
  Subscriber,
  SubscriberRepository,
  SubscriptionNotifier,
} from "./types.js";

export interface SubscribeDependencies {
  repository: SubscriberRepository;
  notifier?: SubscriptionNotifier | null;
}

export interface SubscribeResult {
  status: "subscribed" | "existing";
  message: string;
}

const inFlightSubscriptions = new Map<string, Promise<SubscribeResult>>();

async function createSubscriber(
  subscriber: Subscriber,
  dependencies: SubscribeDependencies,
): Promise<SubscribeResult> {
  if (await dependencies.repository.exists(subscriber.email)) {
    return {
      status: "existing",
      message: "这个邮箱已经在订阅列表中，无需重复提交。",
    };
  }

  await dependencies.repository.create(subscriber);

  if (dependencies.notifier) {
    try {
      await dependencies.notifier.notify(subscriber);
    } catch (error) {
      console.error("订阅已写入，但通知邮件发送失败", error);
    }
  }

  return {
    status: "subscribed",
    message: "订阅成功。下一期科技早报将发送到你的邮箱。",
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
      status: "existing",
      message: "这个邮箱已经在订阅列表中，无需重复提交。",
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
