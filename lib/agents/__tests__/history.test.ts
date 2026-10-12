import { describe, it, expect } from "vitest";
import { historyFromDb } from "@/lib/agents/runtime";

describe("historyFromDb", () => {
  it("dedupes by id and ends on user turn", () => {
    const rows = [
      { id: "m1", role: "user", content: { text: "hi" } },
      { id: "m2", role: "assistant", content: { text: "hello" } },
      { id: "m1", role: "user", content: { text: "hi2" } },
    ] as any;
    const h = historyFromDb(rows);
    expect(h.length).toBe(1);
    expect(h[0].role).toBe("user");
  });
  it("trims trailing assistant messages", () => {
    const rows = [
      { id: "1", role: "user", content: { text: "a" } },
      { id: "2", role: "assistant", content: { text: "b" } },
    ];
    const h = historyFromDb(rows);
    expect(h[h.length - 1]?.role).toBe("user");
  });
});
