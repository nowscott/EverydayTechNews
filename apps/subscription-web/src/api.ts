export interface SubscribeInput {
  name: string;
  email: string;
  company: string;
}

export interface SubscribeResponse {
  ok: boolean;
  status?: "subscribed" | "existing";
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
