import { describe, it, expect } from "vitest";
import { isGreeting } from "@/lib/agents/greeting";

describe("isGreeting", () => {
  it("detects greetings", () => {
    expect(isGreeting("Hi")).toBe(true);
    expect(isGreeting("Hello there")).toBe(true);
    expect(isGreeting("Can I book for tomorrow")).toBe(false);
  });
});
