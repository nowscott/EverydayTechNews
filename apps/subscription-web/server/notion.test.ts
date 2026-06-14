import { describe, expect, it } from "vitest";
import {
  buildStatusProperty,
  buildSubscriberProperties,
} from "./notion.js";

describe("buildSubscriberProperties", () => {
  it("writes a pending select status before email confirmation", () => {
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
        select: { name: "待确认" },
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
        status: { name: "待确认" },
      },
    });
  });

  it("builds the active status update after confirmation", () => {
    expect(
      buildStatusProperty({ name: "状态", type: "select" }, "正常"),
    ).toEqual({
      状态: {
        select: { name: "正常" },
      },
    });
  });
});
