export interface SubscribeInput {
  name: string;
  email: string;
  company: string;
}

export interface SubscribeResponse {
  ok: boolean;
  status?: "pending" | "existing";
  message: string;
}

export interface ConfirmationResponse {
  ok: boolean;
  status?: "confirmed" | "used" | "expired" | "invalid";
  message: string;
}

export interface UnsubscribeResponse {
  ok: boolean;
  status?: "unsubscribed" | "used" | "expired" | "invalid";
  message: string;
}

export async function subscribe(input: SubscribeInput): Promise<SubscribeResponse> {
  const response = await fetch("/api/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });

  const body = (await response.json().catch(() => null)) as SubscribeResponse | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || "订阅暂时不可用，请稍后重试。");
  }
  return body;
}

export async function confirmSubscription(
  token: string,
): Promise<ConfirmationResponse> {
  const response = await fetch("/api/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });

  const body = (await response
    .json()
    .catch(() => null)) as ConfirmationResponse | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || "暂时无法确认订阅，请稍后重试。");
  }
  return body;
}

export async function unsubscribe(
  token: string,
): Promise<UnsubscribeResponse> {
  const response = await fetch("/api/unsubscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });

  const body = (await response
    .json()
    .catch(() => null)) as UnsubscribeResponse | null;
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || "暂时无法退订，请稍后重试。");
  }
  return body;
}
