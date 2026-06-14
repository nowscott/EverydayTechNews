import type { IncomingHttpHeaders } from "node:http";
import { ZodError } from "zod";
import { createSubscriptionNotifier } from "../server/mailer.js";
import { createNotionSubscriberRepository } from "../server/notion.js";
import { checkRateLimit } from "../server/rate-limit.js";
import { registerSubscriber } from "../server/subscribe.js";
import { parseSubscriptionRequest } from "../server/validation.js";

interface ApiRequest {
  method?: string;
  body?: unknown;
  headers: IncomingHttpHeaders;
  socket: {
    remoteAddress?: string | null;
  };
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
}

function clientAddress(request: ApiRequest) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  response.setHeader("Cache-Control", "no-store");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({
      ok: false,
      message: "此接口只接受 POST 请求。",
    });
  }

  try {
    const input = parseSubscriptionRequest(request.body);

    // Honeypot fields should look successful to automated submitters.
    if (input.company) {
      return response.status(200).json({
        ok: true,
        status: "subscribed",
        message: "订阅成功。",
      });
    }

    const rateLimit = checkRateLimit(clientAddress(request));
    if (!rateLimit.allowed) {
      response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
      return response.status(429).json({
        ok: false,
        message: "提交次数过多，请稍后再试。",
      });
    }

    const result = await registerSubscriber(
      { name: input.name, email: input.email },
      {
        repository: createNotionSubscriberRepository(),
        notifier: createSubscriptionNotifier(),
      },
    );

    return response.status(result.status === "subscribed" ? 201 : 200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return response.status(400).json({
        ok: false,
        message: error.issues[0]?.message || "提交内容无效。",
      });
    }

    console.error("订阅接口执行失败", error);
    return response.status(500).json({
      ok: false,
      message: "订阅暂时不可用，请稍后重试。",
    });
  }
}
