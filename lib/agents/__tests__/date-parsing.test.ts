import { describe, it, expect } from "vitest";
import { hasDateIndicator, expandBareOrdinals } from "@/lib/agents/date-parsing";

describe("date parsing helpers", () => {
  it("detects common indicators", () => {
    expect(hasDateIndicator("check for 5th")).toBe(true);
    expect(hasDateIndicator("tomorrow 2pm")).toBe(true);
    expect(hasDateIndicator("on 12th")).toBe(true);
  });
  it("expands bare ordinals", () => {
    const ref = new Date("2025-10-06T00:00:00Z");
    const res = expandBareOrdinals("check for 5th", ref);
    expect(res.toLowerCase()).toContain("october");
  });
});
