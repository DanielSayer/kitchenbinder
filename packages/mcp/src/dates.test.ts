import { expect, it } from "vitest";
import { addDays, thisWeek } from "./dates";

it("uses Brisbane calendar dates and the user's week-start preference across year boundaries", () => {
  expect(thisWeek(1, new Date("2026-11-15T15:00:00Z"))).toEqual({
    start: "2026-11-16",
    end: "2026-11-22",
  });
  expect(thisWeek(0, new Date("2026-11-15T15:00:00Z"))).toEqual({
    start: "2026-11-15",
    end: "2026-11-21",
  });
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});
