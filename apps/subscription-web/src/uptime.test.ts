import { describe, expect, it } from "vitest";
import { getStableOperationDays } from "./uptime";

describe("getStableOperationDays", () => {
  it("counts the first operating day inclusively", () => {
    expect(getStableOperationDays(new Date("2024-06-03T16:00:00Z"))).toBe(1);
  });

  it("uses the Shanghai calendar date", () => {
    expect(getStableOperationDays(new Date("2026-06-13T16:00:00Z"))).toBe(741);
  });
});
