import { describe, it, expect } from "vitest";
import { rejectPastDate } from "@/lib/agents/date-validation";

describe("date validation", () => {
  it("rejects past dates", () => {
    expect(() => rejectPastDate("2000-01-01T00:00:00Z")).toThrow();
  });
  it("accepts future dates", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(() => rejectPastDate(future)).not.toThrow();
  });
});
