import { describe, expect, it } from "vitest";
import { addDays, thisWeek, weekRange } from "./dates";

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

describe("weekRange", () => {
  const week = { start: "2026-11-16", end: "2026-11-22" };
  const unused = () => Promise.reject(new Error("default week not expected"));

  it("uses the default week only when both bounds are missing", async () => {
    expect(await weekRange({}, async () => week)).toEqual(week);
  });
  it("extends a single bound to a week", async () => {
    expect(await weekRange({ start: "2026-12-29" }, unused)).toEqual({
      start: "2026-12-29",
      end: "2027-01-04",
    });
    expect(await weekRange({ end: "2027-01-02" }, unused)).toEqual({
      start: "2026-12-27",
      end: "2027-01-02",
    });
  });
  it("keeps explicit bounds unchanged", async () => {
    const range = { start: "2026-11-20", end: "2026-11-18" };
    expect(await weekRange(range, unused)).toEqual(range);
  });
});
