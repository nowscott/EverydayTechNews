import { describe, expect, it } from "vitest";
import { buildSubscriberProperties } from "./notion.js";

describe("buildSubscriberProperties", () => {
  it("writes the normal select status required by the mail pipeline", () => {
    expect(
      buildSubscriberProperties(
        { name: "小林", email: "user@example.com" },
        { name: "状态", type: "select" },
      ),
    ).toEqual({
      Name: {
        title: [{ text: { content: "小林" } }],
      },
      Email: {
        email: "user@example.com",
      },
      状态: {
        select: { name: "正常" },
      },
    });
  });

  it("supports Notion status properties", () => {
    expect(
      buildSubscriberProperties(
        { name: "Alice", email: "alice@example.com" },
        { name: "Status", type: "status" },
      ),
    ).toMatchObject({
      Status: {
        status: { name: "正常" },
      },
    });
  });
});
