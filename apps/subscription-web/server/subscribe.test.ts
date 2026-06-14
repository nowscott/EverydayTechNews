import { describe, expect, it, vi } from "vitest";
import { registerSubscriber } from "./subscribe.js";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    repository: {
      find: vi.fn().mockResolvedValue(null),
      createPending: vi.fn().mockResolvedValue(undefined),
      restorePending: vi.fn().mockResolvedValue(undefined),
      activate: vi.fn().mockResolvedValue(undefined),
    },
    confirmationMailer: {
      sendConfirmation: vi.fn().mockResolvedValue(undefined),
    },
    createConfirmationLink: vi.fn().mockReturnValue("https://example.com/confirm"),
    ...overrides,
  };
}

describe("registerSubscriber", () => {
  it("does not resend mail to an active subscriber", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue({
      id: "page-id",
      name: "小林",
      email: "user@example.com",
      status: "正常",
    });

    const result = await registerSubscriber(
      { name: "小林", email: "user@example.com" },
      deps,
    );

    expect(result.status).toBe("existing");
    expect(deps.repository.createPending).not.toHaveBeenCalled();
    expect(deps.confirmationMailer.sendConfirmation).not.toHaveBeenCalled();
  });

  it("creates a pending subscriber and sends a confirmation link", async () => {
    const deps = dependencies();
    const result = await registerSubscriber(
      { name: "小林", email: "user@example.com" },
      deps,
    );

    expect(result.status).toBe("pending");
    expect(deps.repository.createPending).toHaveBeenCalledOnce();
    expect(deps.confirmationMailer.sendConfirmation).toHaveBeenCalledWith(
      { name: "小林", email: "user@example.com" },
      "https://example.com/confirm",
    );
  });

  it("resends a fresh link to a pending subscriber", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue({
      id: "page-id",
      name: "小林",
      email: "user@example.com",
      status: "待确认",
    });

    const result = await registerSubscriber(
      { name: "小林", email: "user@example.com" },
      deps,
    );

    expect(result.status).toBe("pending");
    expect(deps.repository.createPending).not.toHaveBeenCalled();
    expect(deps.confirmationMailer.sendConfirmation).toHaveBeenCalledOnce();
  });

  it("restores an unsubscribed subscriber to pending", async () => {
    const deps = dependencies();
    deps.repository.find.mockResolvedValue({
      id: "page-id",
      name: "旧称呼",
      email: "user@example.com",
      status: "已退订",
    });

    const result = await registerSubscriber(
      { name: "新称呼", email: "user@example.com" },
      deps,
    );

    expect(result.status).toBe("pending");
    expect(deps.repository.createPending).not.toHaveBeenCalled();
    expect(deps.repository.restorePending).toHaveBeenCalledWith("page-id", {
      name: "新称呼",
      email: "user@example.com",
    });
    expect(deps.confirmationMailer.sendConfirmation).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent submissions for the same email", async () => {
    let releaseCreate: (() => void) | undefined;
    const deps = dependencies();
    deps.repository.createPending.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseCreate = resolve;
        }),
    );

    const first = registerSubscriber(
      { name: "小林", email: "USER@example.com" },
      deps,
    );
    const second = registerSubscriber(
      { name: "小林", email: "user@example.com" },
      deps,
    );

    await vi.waitFor(() =>
      expect(deps.repository.createPending).toHaveBeenCalledOnce(),
    );
    releaseCreate?.();

    await expect(first).resolves.toMatchObject({ status: "pending" });
    await expect(second).resolves.toMatchObject({ status: "pending" });
    expect(deps.repository.find).toHaveBeenCalledOnce();
    expect(deps.confirmationMailer.sendConfirmation).toHaveBeenCalledOnce();
  });
});
