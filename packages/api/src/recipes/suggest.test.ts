import { describe, expect, it } from "vitest";
import { type SuggestionCandidate, suggest } from "./suggest";

const today = "2026-10-28";
let next = 0;
function candidate(
  values: Partial<SuggestionCandidate> = {},
): SuggestionCandidate {
  next++;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    title: `Recipe ${next}`,
    photo: null,
    ownerId: "owner",
    servings: null,
    createdAt: `2026-01-${String((next % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    rating: null,
    favourite: false,
    lastHad: null,
    tagIds: [],
    ...values,
  };
}
const options = { today, seed: "seed", excludeIds: new Set<string>() };
const ids = (rows: ReturnType<typeof suggest>, key: string) =>
  rows.find((row) => row.key === key)?.items.map((item) => item.id) ?? [];

describe("meal suggestions", () => {
  it("places each recipe in the first matching row", () => {
    const loved = candidate({ rating: 4.5, lastHad: "2026-09-01" });
    const favourite = candidate({ favourite: true, lastHad: "2026-10-01" });
    const old = candidate({ rating: 3, lastHad: "2026-07-01" });
    const lovedOld = candidate({ rating: 5, lastHad: "2026-01-01" });
    const recent = candidate({ rating: 5, lastHad: "2026-10-20" });
    const ratedUntried = candidate({ rating: 5 });
    const untried = candidate();
    const rows = suggest(
      [loved, favourite, old, lovedOld, recent, ratedUntried, untried],
      options,
    );
    expect(ids(rows, "favourites").sort()).toEqual(
      [loved.id, favourite.id, lovedOld.id].sort(),
    );
    expect(ids(rows, "forgotten")).toEqual([old.id]);
    expect(ids(rows, "untried").sort()).toEqual(
      [ratedUntried.id, untried.id].sort(),
    );
  });

  it("excludes the viewed week and low household ratings", () => {
    const planned = candidate();
    const disliked = candidate({ rating: 2.4 });
    const borderline = candidate({ rating: 2.5 });
    const rows = suggest([planned, disliked, borderline], {
      ...options,
      excludeIds: new Set([planned.id]),
    });
    expect(ids(rows, "untried")).toEqual([borderline.id]);
  });

  it("shows six per row, stable per seed, varied across seeds", () => {
    const pool = Array.from({ length: 15 }, () => candidate());
    const first = ids(suggest(pool, options), "untried");
    expect(first).toHaveLength(6);
    expect(ids(suggest(pool, options), "untried")).toEqual(first);
    const seeds = Array.from({ length: 10 }, (_, index) =>
      ids(
        suggest(pool, { ...options, seed: `seed-${index}` }),
        "untried",
      ).join(),
    );
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("only draws from the best fifteen", () => {
    const pool = Array.from({ length: 20 }, (_, index) =>
      candidate({ lastHad: `2026-0${(index % 5) + 1}-01`, rating: 3 }),
    );
    const best = new Set(
      [...pool]
        .sort(
          (a, b) =>
            (a.lastHad ?? "").localeCompare(b.lastHad ?? "") ||
            a.id.localeCompare(b.id),
        )
        .slice(0, 15)
        .map((item) => item.id),
    );
    for (let index = 0; index < 10; index++)
      for (const id of ids(
        suggest(pool, { ...options, seed: `${index}` }),
        "forgotten",
      ))
        expect(best.has(id)).toBe(true);
  });

  it("allows at most two cards per tag", () => {
    const pasta = Array.from({ length: 5 }, () =>
      candidate({ tagIds: ["pasta"] }),
    );
    const other = Array.from({ length: 5 }, () => candidate());
    const rows = suggest([...pasta, ...other], options);
    const shown = ids(rows, "untried");
    expect(shown).toHaveLength(6);
    expect(
      shown.filter((id) => pasta.some((item) => item.id === id)),
    ).toHaveLength(2);
  });

  it("returns every row, even when empty", () => {
    expect(suggest([], options).map((row) => row.key)).toEqual([
      "favourites",
      "forgotten",
      "untried",
    ]);
  });
});
