import nodemailer from "nodemailer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSubscriptionMailers } from "./mailer.js";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(),
  },
}));

const sendMail = vi.fn();

describe("createSubscriptionMailers", () => {
  beforeEach(() => {
    sendMail.mockReset();
    sendMail.mockResolvedValue({ messageId: "test" });
    vi.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail,
    } as never);
  });

  it("sends the one-time confirmation link to the subscriber", async () => {
    const { confirmationMailer } = createSubscriptionMailers({
      SENDING_ACCOUNT: "sender@example.com",
      SENDING_PASSWORD: "password",
      SERVER: "smtp.example.com",
    });

    await confirmationMailer.sendConfirmation(
      { name: "小林", email: "user@example.com" },
      "https://example.com/?confirmation_token=signed-token",
    );

    expect(sendMail).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "sender@example.com",
        to: "user@example.com",
        subject: "每日科技早报：请确认你的订阅",
        text: expect.stringContaining("signed-token"),
      }),
    );
  });

  it("preserves the optional owner notification after confirmation", async () => {
    const { ownerNotifier } = createSubscriptionMailers({
      SENDING_ACCOUNT: "sender@example.com",
      SENDING_PASSWORD: "password",
      SERVER: "smtp.example.com",
      NOTIFICATION_EMAIL: "owner@example.com",
    });

    await ownerNotifier?.notifyOwner({
      name: "小林",
      email: "user@example.com",
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@example.com",
        subject: "每日科技早报：新订阅通知",
      }),
    );
  });

  it("requires complete SMTP settings", () => {
    expect(() => createSubscriptionMailers({})).toThrow(
      "SMTP 环境变量不完整",
    );
  });
});
