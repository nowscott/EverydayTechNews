import { describe, expect, it, vi } from "vitest";
import { registerSubscriber } from "./subscribe.js";

describe("registerSubscriber", () => {
  it("does not create duplicate subscribers", async () => {
    const create = vi.fn();
    const result = await registerSubscriber(
      { name: "小林", email: "user@example.com" },
      {
        repository: {
          exists: vi.fn().mockResolvedValue(true),
          create,
        },
      },
    );

    expect(result.status).toBe("existing");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps a successful subscription when notification mail fails", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockRejectedValue(new Error("SMTP unavailable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await registerSubscriber(
      { name: "小林", email: "user@example.com" },
      {
        repository: {
          exists: vi.fn().mockResolvedValue(false),
          create,
        },
        notifier: { notify },
      },
    );

    expect(result.status).toBe("subscribed");
    expect(create).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("coalesces concurrent submissions for the same email", async () => {
    let releaseCreate: (() => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCreate = resolve;
        }),
    );
    const repository = {
      exists: vi.fn().mockResolvedValue(false),
      create,
    };

    const first = registerSubscriber(
      { name: "小林", email: "USER@example.com" },
      { repository },
    );
    const second = registerSubscriber(
      { name: "小林", email: "user@example.com" },
      { repository },
    );

    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    releaseCreate?.();

    await expect(first).resolves.toMatchObject({ status: "subscribed" });
    await expect(second).resolves.toMatchObject({ status: "existing" });
    expect(repository.exists).toHaveBeenCalledOnce();
  });
});
