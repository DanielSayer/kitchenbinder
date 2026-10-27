import { describe, expect, it } from "vitest";
import { weekStart } from "./dates";

describe("weekStart", () => {
  // 2026-10-25 is a Sunday.
  it("defaults to Monday", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
  });

  it("honours the chosen first day", () => {
    expect(weekStart("2026-10-25", 0)).toBe("2026-10-25");
    expect(weekStart("2026-10-24", 0)).toBe("2026-10-18");
    expect(weekStart("2026-10-25", 6)).toBe("2026-10-24");
    expect(weekStart("2026-10-23", 6)).toBe("2026-10-17");
  });
});
