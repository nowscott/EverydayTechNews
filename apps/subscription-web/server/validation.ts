import { z } from "zod";

const subscriptionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入你的称呼")
    .max(50, "称呼不能超过 50 个字符"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "邮箱地址过长")
    .email("请输入有效的邮箱地址"),
  company: z.string().max(200).optional().default(""),
});

export type SubscriptionRequest = z.infer<typeof subscriptionSchema>;

export function parseSubscriptionRequest(input: unknown): SubscriptionRequest {
  return subscriptionSchema.parse(input);
}
