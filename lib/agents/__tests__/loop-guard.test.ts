import { describe, it, expect } from "vitest";
import { hashArgs, shouldSuppressRepeat, updateLoopGuard } from "@/lib/agents/loop-guard";

describe("loop guard", () => {
  it("suppresses after repeats", () => {
    let s = updateLoopGuard({}, "check_availability", { date: "2025-10-06" });
    s = updateLoopGuard(s, "check_availability", { date: "2025-10-06" });
    s = updateLoopGuard(s, "check_availability", { date: "2025-10-06" });
    expect(shouldSuppressRepeat(s, "check_availability", { date: "2025-10-06" })).toBe(true);
  });
  it("resets on different args", () => {
    let s = updateLoopGuard({}, "check_availability", { date: "2025-10-06" });
    s = updateLoopGuard(s, "check_availability", { date: "2025-10-07" });
    expect(shouldSuppressRepeat(s, "check_availability", { date: "2025-10-07" })).toBe(false);
  });
});
