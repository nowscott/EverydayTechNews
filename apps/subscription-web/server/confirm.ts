import type {
  OwnerNotifier,
  SubscriberRepository,
} from "./types.js";

export interface ConfirmDependencies {
  repository: SubscriberRepository;
  ownerNotifier?: OwnerNotifier | null;
}

export type ConfirmResult = "confirmed" | "used" | "invalid";

export async function confirmSubscriber(
  email: string,
  dependencies: ConfirmDependencies,
): Promise<ConfirmResult> {
  const subscriber = await dependencies.repository.find(
    email.trim().toLowerCase(),
  );
  if (!subscriber) return "invalid";
  if (subscriber.status === "正常") return "used";
  if (subscriber.status !== "待确认") return "invalid";

  await dependencies.repository.activate(subscriber.id);

  if (dependencies.ownerNotifier) {
    try {
      await dependencies.ownerNotifier.notifyOwner(subscriber);
    } catch (error) {
      console.error("订阅已确认，但站长通知发送失败", error);
    }
  }

  return "confirmed";
}
