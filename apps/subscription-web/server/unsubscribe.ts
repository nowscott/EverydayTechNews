import type { SubscriberRepository } from "./types.js";

export type UnsubscribeResult =
  | { status: "unsubscribed" | "used"; name: string }
  | { status: "invalid"; name: null };

export async function unsubscribeSubscriber(
  email: string,
  repository: SubscriberRepository,
): Promise<UnsubscribeResult> {
  const subscriber = await repository.find(email.trim().toLowerCase());
  if (!subscriber) return { status: "invalid", name: null };
  if (subscriber.status === "已退订") {
    return { status: "used", name: subscriber.name };
  }
  if (subscriber.status !== "正常") {
    return { status: "invalid", name: null };
  }

  await repository.unsubscribe(subscriber.id);
  return { status: "unsubscribed", name: subscriber.name };
}
