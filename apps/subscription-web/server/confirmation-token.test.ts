import { describe, expect, it } from "vitest";
import {
  ConfirmationTokenError,
  createConfirmationToken,
  verifyConfirmationToken,
} from "./confirmation-token.js";

const SECRET = "test-secret-with-enough-entropy";
const NOW = new Date("2026-06-14T00:00:00Z");

describe("confirmation tokens", () => {
  it("verifies a signed token before it expires", () => {
    const token = createConfirmationToken(
      "User@Example.com",
      SECRET,
      NOW,
      60,
    );

    expect(
      verifyConfirmationToken(
        token,
        SECRET,
        new Date("2026-06-14T00:00:30Z"),
      ),
    ).toMatchObject({
      email: "user@example.com",
    });
  });

  it("rejects a modified token", () => {
    const token = createConfirmationToken("user@example.com", SECRET, NOW, 60);
    const modified = `${token.slice(0, -1)}x`;

    expect(() => verifyConfirmationToken(modified, SECRET, NOW)).toThrow(
      ConfirmationTokenError,
    );
  });

  it("rejects an expired token", () => {
    const token = createConfirmationToken("user@example.com", SECRET, NOW, 60);

    try {
      verifyConfirmationToken(
        token,
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
