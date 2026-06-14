import type {
  OwnerNotifier,
  SubscriberRecord,
  SubscriberRepository,
  SuccessMailer,
} from "./types.js";

export interface ConfirmDependencies {
  repository: SubscriberRepository;
  successMailer: SuccessMailer;
  ownerNotifier?: OwnerNotifier | null;
}

export type ConfirmResult =
  | { status: "confirmed" | "used"; subscriber: SubscriberRecord }
  | { status: "invalid"; subscriber: null };

export async function confirmSubscriber(
  email: string,
  dependencies: ConfirmDependencies,
): Promise<ConfirmResult> {
  const subscriber = await dependencies.repository.find(
    email.trim().toLowerCase(),
  );
  if (!subscriber) return { status: "invalid", subscriber: null };
  if (subscriber.status === "正常") {
    return { status: "used", subscriber };
  }
  if (subscriber.status !== "待确认") {
    return { status: "invalid", subscriber: null };
  }

  await dependencies.repository.activate(subscriber.id);

  try {
    await dependencies.successMailer.sendSuccess(subscriber);
  } catch (error) {
    console.error("订阅已确认，但订阅成功邮件发送失败", error);
  }

  if (dependencies.ownerNotifier) {
    try {
      await dependencies.ownerNotifier.notifyOwner(subscriber);
    } catch (error) {
      console.error("订阅已确认，但站长通知发送失败", error);
    }
  }

  return { status: "confirmed", subscriber };
}
