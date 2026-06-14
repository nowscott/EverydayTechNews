import { describe, expect, it, vi } from "vitest";
import { confirmSubscriber } from "./confirm.js";

function repository(status: string | null) {
  return {
    find: vi.fn().mockResolvedValue({
      id: "page-id",
      name: "小林",
      email: "user@example.com",
      status,
    }),
    createPending: vi.fn(),
    restorePending: vi.fn(),
    activate: vi.fn().mockResolvedValue(undefined),
  };
}

describe("confirmSubscriber", () => {
  it("activates a pending subscriber and notifies the owner", async () => {
    const repo = repository("待确认");
    const notifyOwner = vi.fn().mockResolvedValue(undefined);
    const sendSuccess = vi.fn().mockResolvedValue(undefined);

    await expect(
      confirmSubscriber("user@example.com", {
        repository: repo,
        successMailer: { sendSuccess },
        ownerNotifier: { notifyOwner },
      }),
    ).resolves.toMatchObject({ status: "confirmed" });

    expect(repo.activate).toHaveBeenCalledWith("page-id");
    expect(sendSuccess).toHaveBeenCalledOnce();
    expect(notifyOwner).toHaveBeenCalledOnce();
  });

  it("treats a second confirmation as an already used link", async () => {
    const repo = repository("正常");

    await expect(
      confirmSubscriber("user@example.com", {
        repository: repo,
        successMailer: { sendSuccess: vi.fn() },
      }),
    ).resolves.toMatchObject({ status: "used" });
    expect(repo.activate).not.toHaveBeenCalled();
  });

  it("does not activate disabled subscribers", async () => {
    const repo = repository("异常");

    await expect(
      confirmSubscriber("user@example.com", {
        repository: repo,
        successMailer: { sendSuccess: vi.fn() },
      }),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(repo.activate).not.toHaveBeenCalled();
  });
});
