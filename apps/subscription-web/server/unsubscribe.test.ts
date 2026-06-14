import { describe, expect, it, vi } from "vitest";
import { unsubscribeSubscriber } from "./unsubscribe.js";

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
    activate: vi.fn(),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
  };
}

describe("unsubscribeSubscriber", () => {
  it("marks an active subscriber as unsubscribed", async () => {
    const repo = repository("正常");

    await expect(
      unsubscribeSubscriber("user@example.com", repo),
    ).resolves.toEqual({
      status: "unsubscribed",
      name: "小林",
    });
    expect(repo.unsubscribe).toHaveBeenCalledWith("page-id");
  });

  it("treats a repeated unsubscribe as already complete", async () => {
    const repo = repository("已退订");

    await expect(
      unsubscribeSubscriber("user@example.com", repo),
    ).resolves.toMatchObject({ status: "used" });
    expect(repo.unsubscribe).not.toHaveBeenCalled();
  });

  it("does not unsubscribe pending or disabled records", async () => {
    const repo = repository("待确认");

    await expect(
      unsubscribeSubscriber("user@example.com", repo),
    ).resolves.toMatchObject({ status: "invalid" });
    expect(repo.unsubscribe).not.toHaveBeenCalled();
  });
});
