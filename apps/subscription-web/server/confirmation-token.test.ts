import { describe, expect, it } from "vitest";
import {
  ConfirmationTokenError,
  createSubscriptionToken,
  verifySubscriptionToken,
} from "./confirmation-token.js";

const SECRET = "test-secret-with-enough-entropy";
const NOW = new Date("2026-06-14T00:00:00Z");

describe("subscription tokens", () => {
  it("verifies a signed confirmation token before it expires", () => {
    const { token } = createSubscriptionToken(
      "User@Example.com",
      "confirm",
      SECRET,
      NOW,
      60,
    );

    expect(
      verifySubscriptionToken(
        token,
        "confirm",
        SECRET,
        new Date("2026-06-14T00:00:30Z"),
      ),
    ).toMatchObject({
      email: "user@example.com",
    });
  });

  it("does not allow a confirmation token to unsubscribe", () => {
    const { token } = createSubscriptionToken(
      "user@example.com",
      "confirm",
      SECRET,
      NOW,
      60,
    );

    expect(() =>
      verifySubscriptionToken(token, "unsubscribe", SECRET, NOW),
    ).toThrow(ConfirmationTokenError);
  });

  it("rejects a modified token", () => {
    const { token } = createSubscriptionToken(
      "user@example.com",
      "confirm",
      SECRET,
      NOW,
      60,
    );
    const modified = `${token.slice(0, -1)}x`;

    expect(() =>
      verifySubscriptionToken(modified, "confirm", SECRET, NOW),
    ).toThrow(ConfirmationTokenError);
  });

  it("rejects an expired token", () => {
    const { token } = createSubscriptionToken(
      "user@example.com",
      "confirm",
      SECRET,
      NOW,
      60,
    );

    try {
      verifySubscriptionToken(
        token,
        "confirm",
        SECRET,
        new Date("2026-06-14T00:01:00Z"),
      );
      throw new Error("Expected token verification to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfirmationTokenError);
      expect((error as ConfirmationTokenError).code).toBe("expired");
    }
  });
});
