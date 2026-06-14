import { z, ZodError } from "zod";
import {
  ConfirmationTokenError,
  verifyEnvironmentSubscriptionToken,
} from "../server/confirmation-token.js";
import { createNotionSubscriberRepository } from "../server/notion.js";
import { unsubscribeSubscriber } from "../server/unsubscribe.js";

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
}

const unsubscribeSchema = z.object({
  token: z.string().min(1).max(2_048),
});

export default async function handler(
  request: ApiRequest,
  response: ApiResponse,
) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({
      ok: false,
      message: "此接口只接受 POST 请求。",
    });
  }

  try {
    const { token } = unsubscribeSchema.parse(request.body);
    const { email } = verifyEnvironmentSubscriptionToken(token, "unsubscribe");
    const result = await unsubscribeSubscriber(
      email,
      createNotionSubscriberRepository(),
    );

    if (result.status === "invalid") {
      return response.status(400).json({
        ok: false,
        status: result.status,
        message: "退订链接无效或当前订阅状态不允许退订。",
      });
    }

    return response.status(200).json({
      ok: true,
      status: result.status,
      message:
        result.status === "unsubscribed"
          ? `${result.name}，你已成功退订每日科技早报。`
          : `${result.name}，这个邮箱已经退订，无需重复操作。`,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return response.status(400).json({
        ok: false,
        message: "退订链接无效。",
      });
    }
    if (error instanceof ConfirmationTokenError) {
      return response.status(400).json({
        ok: false,
        status: error.code,
        message:
          error.code === "expired"
            ? "退订链接已过期，请使用最近一期邮件中的链接。"
            : "退订链接无效。",
      });
    }

    console.error("退订接口执行失败", error);
    return response.status(500).json({
      ok: false,
      message: "暂时无法退订，请稍后重试。",
    });
  }
}
