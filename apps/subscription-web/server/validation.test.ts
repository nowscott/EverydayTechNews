import { describe, expect, it } from "vitest";
import { parseSubscriptionRequest } from "./validation.js";

describe("parseSubscriptionRequest", () => {
  it("normalizes subscriber input", () => {
    expect(
      parseSubscriptionRequest({
        name: "  小林  ",
        email: "  User@Example.COM ",
      }),
    ).toEqual({
      name: "小林",
      email: "user@example.com",
      company: "",
    });
  });

  it("rejects invalid email addresses", () => {
    expect(() =>
      parseSubscriptionRequest({
        name: "小林",
        email: "invalid",
      }),
    ).toThrow();
  });
});
