import { describe, expect, it } from "vitest";
import { ago, reason } from "./suggestion-rows";

const today = "2026-10-28";
const item = {
  id: "id",
  title: "Curry",
  photo: null,
  ownerId: null,
  servings: null,
  rating: null,
  favourite: false,
  lastHad: null,
};

describe("suggestion reasons", () => {
  it("describes how long ago", () => {
    expect(ago("2026-10-27", today)).toBe("yesterday");
    expect(ago("2026-10-18", today)).toBe("10 days ago");
    expect(ago("2026-09-16", today)).toBe("6 wks ago");
    expect(ago("2026-07-28", today)).toBe("3 mths ago");
    expect(ago("2023-10-28", today)).toBe("3 yrs ago");
  });
  it("leads with rating, then favourite", () => {
    expect(
      reason({ ...item, rating: 4.25, lastHad: "2026-09-16" }, today),
    ).toBe("★4.3 · last had 6 wks ago");
    expect(reason({ ...item, favourite: true }, today)).toBe(
      "Favourite · never had",
    );
    expect(reason(item, today)).toBe("Never had");
  });
});
