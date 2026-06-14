import { z, ZodError } from "zod";
import {
  ConfirmationTokenError,
  verifyEnvironmentConfirmationToken,
} from "../server/confirmation-token.js";
import { confirmSubscriber } from "../server/confirm.js";
import { createSubscriptionMailers } from "../server/mailer.js";
import { createNotionSubscriberRepository } from "../server/notion.js";

interface ApiRequest {
  method?: string;
  body?: unknown;
}

interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): unknown;
}

const confirmationSchema = z.object({
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
    const { token } = confirmationSchema.parse(request.body);
    const { email } = verifyEnvironmentConfirmationToken(token);
    const { ownerNotifier } = createSubscriptionMailers();
    const result = await confirmSubscriber(email, {
      repository: createNotionSubscriberRepository(),
      ownerNotifier,
    });

    if (result === "invalid") {
      return response.status(400).json({
        ok: false,
        status: result,
        message: "确认链接无效，请重新提交邮箱获取新链接。",
      });
    }

    return response.status(200).json({
      ok: true,
      status: result,
      message:
        result === "confirmed"
          ? "邮箱确认完成，下一期科技早报将发送到你的邮箱。"
          : "这个确认链接已经使用过，你的订阅已生效。",
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return response.status(400).json({
        ok: false,
        message: "确认链接无效，请重新提交邮箱获取新链接。",
      });
    }

    if (error instanceof ConfirmationTokenError) {
      return response.status(400).json({
        ok: false,
        status: error.code,
        message:
          error.code === "expired"
            ? "确认链接已过期，请重新提交邮箱获取新链接。"
            : "确认链接无效，请重新提交邮箱获取新链接。",
      });
    }

    console.error("确认订阅接口执行失败", error);
    return response.status(500).json({
      ok: false,
      message: "暂时无法确认订阅，请稍后重试。",
    });
  }
}
