import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { group, groupMember } from "@prep-sheet/db/schema/group";
import {
  recipe,
  recipeCooking,
  recipeFavourite,
  recipeRating,
} from "@prep-sheet/db/schema/recipe";
import { recipeTag, tag } from "@prep-sheet/db/schema/tag";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Context } from "../context";
import { appRouter } from "../routers/index";
import { sampleRecipe } from "./fixtures";
import { collectionInput, collectionQueries } from "./list";

const ownerId = randomUUID();
const memberId = randomUUID();
const outsiderId = randomUUID();
const users = [ownerId, memberId, outsiderId];
const groupId = randomUUID();
const otherGroupId = randomUUID();
const tagIds = [randomUUID(), randomUUID()];
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Pagination",
      email: `${id}@example.test`,
      emailVerified: false,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: randomUUID(),
      token: randomUUID(),
      userId: id,
      expiresAt: new Date(Date.now() + 60000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
  return appRouter.createCaller({ auth: null, session });
}
const owner = caller(ownerId);
const member = caller(memberId);
const outsider = caller(outsiderId);
const rows = Array.from({ length: 61 }, (_, index) => ({
  id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  title:
    index < 3
      ? (["Soup 10", "sóup 2", "SOUP 2"][index] ?? "Soup")
      : `Recipe ${index}`,
  userId: ownerId,
  groupId: null,
  origin: "manual" as const,
  createdAt: new Date("2026-09-01T00:00:00Z"),
  content: {
    ...sampleRecipe,
    ingredients:
      index % 2 === 0
        ? ["2 ripe TOMATOES", "Literal %_\\ ingredient"]
        : ["1 onion"],
    description: "A collection summary",
    notes: "Secret notes are not searchable",
    steps: ["Invisible method tomatoes"],
    prepMinutes: index < 2 ? 5 : null,
    cookMinutes: index < 2 ? 10 : 1,
    totalMinutes: index === 0 ? 8 : index === 1 ? 30 : null,
  },
}));
const sharedId = randomUUID();
const deletedId = randomUUID();

describe("paginated recipe lists with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      users.map((id) => ({
        id,
        name: "Pagination",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(group).values([
      { id: groupId, ownerId, name: "Shared" },
      { id: otherGroupId, ownerId: outsiderId, name: "Other" },
    ]);
    await db.insert(groupMember).values([
      { groupId, userId: ownerId },
      { groupId, userId: memberId },
      { groupId: otherGroupId, userId: outsiderId },
    ]);
    await db.insert(recipe).values([
      ...rows,
      {
        id: sharedId,
        title: "Shared soup",
        userId: null,
        groupId,
        origin: "manual",
        content: sampleRecipe,
      },
      {
        id: randomUUID(),
        title: "Other soup",
        userId: null,
        groupId: otherGroupId,
        origin: "manual",
        content: sampleRecipe,
      },
      {
        id: randomUUID(),
        title: "Private soup",
        userId: memberId,
        origin: "manual",
        content: sampleRecipe,
      },
      {
        id: deletedId,
        title: "Deleted soup",
        userId: ownerId,
        origin: "manual",
        content: sampleRecipe,
        deletedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    ]);
    await db.insert(tag).values(
      tagIds.map((id, index) => ({
        id,
        userId: ownerId,
        name: `Page tag ${index}`,
      })),
    );
    await db
      .insert(recipeFavourite)
      .values(
        rows
          .filter((_, index) => index % 2 === 0)
          .map(({ id }) => ({ recipeId: id, userId: ownerId })),
      );
    await db.insert(recipeRating).values([
      { recipeId: rows[0]?.id ?? "", userId: ownerId, rating: 5 },
      { recipeId: rows[1]?.id ?? "", userId: ownerId, rating: 4 },
      { recipeId: sharedId, userId: memberId, rating: 3 },
    ]);
    await db
      .insert(recipeTag)
      .values(
        rows
          .filter((_, index) => index % 4 === 0)
          .flatMap(({ id }) =>
            tagIds.map((tagId) => ({ recipeId: id, userId: ownerId, tagId })),
          ),
      );
    await db.insert(recipeCooking).values([
      {
        id: randomUUID(),
        recipeId: rows[0]?.id ?? "",
        userId: ownerId,
        cookedOn: "2026-08-01",
        note: "",
      },
      {
        id: randomUUID(),
        recipeId: rows[1]?.id ?? "",
        userId: ownerId,
        cookedOn: "2026-09-01",
        note: "",
      },
      {
        id: randomUUID(),
        recipeId: rows[2]?.id ?? "",
        userId: ownerId,
        cookedOn: null,
        note: "Undated",
      },
      {
        id: randomUUID(),
        recipeId: sharedId,
        userId: memberId,
        cookedOn: "2026-09-01",
        note: "Personal cook",
      },
    ]);
  });
  afterAll(async () => {
    await db.delete(group).where(inArray(group.ownerId, users));
    await db.delete(recipe).where(inArray(recipe.userId, users));
    await db.delete(user).where(inArray(user.id, users));
    await db.$client.end();
  });

  it("bounds default/max pages, covers exact and trailing boundaries, and breaks timestamp ties by ID", async () => {
    const pages = await Promise.all(
      [0, 1, 2, 3].map((page) => owner.recipes.list({ page })),
    );
    expect(pages.map((page) => page.items.length)).toEqual([24, 24, 13, 0]);
    expect(pages.map((page) => page.total)).toEqual([61, 61, 61, 61]);
    expect(pages.flatMap((page) => page.items.map((r) => r.id))).toEqual(
      rows.map((r) => r.id),
    );
    expect((await owner.recipes.list({ pageSize: 48 })).items).toHaveLength(48);
    expect(
      (await owner.recipes.list({ pageSize: 1, page: 60 })).items[0]?.id,
    ).toBe(rows[60]?.id);
    await expect(owner.recipes.list({ pageSize: 49 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(owner.recipes.list({ page: -1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(owner.recipes.list({ pageSize: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(pages[0]?.items[0]).toMatchObject({
      ingredientCount: 2,
      description: "A collection summary",
      prepMinutes: 5,
      cookMinutes: 10,
      totalMinutes: 8,
    });
    expect(pages[0]?.items[0]).not.toHaveProperty("content");
    expect(
      (await owner.recipes.get({ id: rows[0]?.id ?? "" })).content.steps,
    ).toEqual(["Invisible method tomatoes"]);
  });

  it("searches names and ingredient lines before slicing pages, treating SQL wildcard characters literally", async () => {
    const found = await Promise.all(
      [0, 1, 2].map((page) =>
        owner.recipes.list({ search: "  tOmAtO  ", page, pageSize: 12 }),
      ),
    );
    expect(found.map((page) => page.items.length)).toEqual([12, 12, 7]);
    expect(found.flatMap((page) => page.items.map((r) => r.id))).toEqual(
      rows.filter((_, i) => i % 2 === 0).map((r) => r.id),
    );
    expect((await owner.recipes.list({ search: "%_\\" })).total).toBe(31);
    expect((await owner.recipes.list({ search: "Secret notes" })).total).toBe(
      0,
    );
    expect(
      (await owner.recipes.list({ search: "Invisible method" })).total,
    ).toBe(0);
    expect(
      (await owner.recipes.list({ search: "RECIPE 60" })).items[0]?.id,
    ).toBe(rows[60]?.id);
  });

  it("applies personal favourites, ratings, all tags and cooking dates across pages", async () => {
    const filters = {
      favouritesOnly: true,
      unratedOnly: true,
      tagIds,
      pageSize: 5,
    };
    const pages = await Promise.all(
      [0, 1, 2].map((page) => owner.recipes.list({ ...filters, page })),
    );
    expect(pages[0]?.total).toBe(15);
    expect(pages.flatMap((page) => page.items.map((r) => r.id))).toEqual(
      rows.filter((_, i) => i > 0 && i % 4 === 0).map((r) => r.id),
    );
    expect((await owner.recipes.list({ neverCooked: true })).total).toBe(58);
    expect(
      (await owner.recipes.list({ cookedBefore: "2026-09-01" })).items.map(
        (r) => r.id,
      ),
    ).toEqual([rows[0]?.id]);
    expect(
      (
        await owner.recipes.list({
          neverCooked: true,
          cookedBefore: "2026-09-01",
        })
      ).total,
    ).toBe(0);
    expect((await owner.recipes.list({ tagIds: [randomUUID()] })).total).toBe(
      0,
    );
  });

  it("keeps natural name, null-last rating/history/time semantics and deterministic ties across pages", async () => {
    const ordered = async (
      sort: "name" | "highest-rated" | "last-cooked" | "cooking-time",
    ) => {
      const pages = await Promise.all(
        [0, 1, 2].map((page) => owner.recipes.list({ sort, page })),
      );
      const again = await owner.recipes.list({ sort, page: 1 });
      expect(again).toEqual(pages[1]);
      const ids = pages.flatMap((page) => page.items.map((r) => r.id));
      expect(new Set(ids).size).toBe(61);
      return ids;
    };
    const names = await ordered("name");
    expect(names.slice(-3)).toEqual([rows[1]?.id, rows[2]?.id, rows[0]?.id]);
    expect(names.indexOf(rows[3]?.id ?? "")).toBeLessThan(
      names.indexOf(rows[10]?.id ?? ""),
    );
    expect((await ordered("highest-rated")).slice(0, 2)).toEqual([
      rows[0]?.id,
      rows[1]?.id,
    ]);
    expect((await ordered("last-cooked")).slice(0, 2)).toEqual([
      rows[1]?.id,
      rows[0]?.id,
    ]);
    // Inconsistent elapsed time falls back to complete active time; partial active time is unknown.
    expect((await ordered("cooking-time")).slice(0, 2)).toEqual([
      rows[0]?.id,
      rows[1]?.id,
    ]);
  });

  it("isolates accounts and groups, including metadata, and excludes deleted recipes from every list/detail projection", async () => {
    expect((await member.recipes.list()).total).toBe(1);
    expect((await outsider.recipes.list()).total).toBe(0);
    const shared = await member.recipes.list({ groupId });
    expect(shared.total).toBe(1);
    expect(shared.items[0]).toMatchObject({
      id: sharedId,
      rating: 3,
      cookedCount: 1,
      isFavourite: false,
      tagIds: [],
    });
    expect((await owner.recipes.list({ groupId })).items[0]).toMatchObject({
      rating: null,
      cookedCount: 0,
    });
    await expect(outsider.recipes.list({ groupId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      member.shopping.recipes({ collection: otherGroupId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await owner.shopping.recipes()).total).toBe(62);
    expect((await member.shopping.recipes()).total).toBe(2);
    expect(
      (await owner.shopping.recipes({ collection: "personal" })).total,
    ).toBe(61);
    expect(
      (await owner.shopping.recipes({ collection: groupId })).items,
    ).toEqual([{ id: sharedId, groupId, title: "Shared soup", servings: "2" }]);
    expect(await member.shopping.recipe({ id: rows[0]?.id ?? "" })).toBeNull();
    expect(await owner.shopping.recipe({ id: deletedId })).toBeNull();
    expect(await member.shopping.recipe({ id: sharedId })).toMatchObject({
      id: sharedId,
      servings: "2",
    });
    expect(
      (await owner.recipes.taggingList({ excludeTagId: tagIds[0] })).total,
    ).toBe(46);
    expect(
      (await member.recipes.taggingList({ excludeTagId: tagIds[0] })).total,
    ).toBe(2);
    expect((await owner.recipes.taggingList({ search: "Deleted" })).total).toBe(
      0,
    );
  });

  it("bounds picker pages and searches/sorts beyond the first page", async () => {
    const pages = await Promise.all(
      [0, 1, 2].map((page) => owner.shopping.recipes({ page })),
    );
    expect(pages.map((page) => page.items.length)).toEqual([24, 24, 14]);
    expect(
      new Set(pages.flatMap((page) => page.items.map((r) => r.id))).size,
    ).toBe(62);
    expect(
      (
        await owner.shopping.recipes({ search: "soup", pageSize: 2, page: 1 })
      ).items.map((r) => r.id),
    ).toEqual([rows[0]?.id]);
    expect((await owner.shopping.recipes({ search: "TOMATO" })).total).toBe(0);
    const tags = await Promise.all(
      [0, 1, 2].map((page) => owner.recipes.taggingList({ page })),
    );
    expect(tags.map((page) => page.items.length)).toEqual([24, 24, 14]);
    expect(
      (await owner.recipes.taggingList({ search: "Recipe 60" })).items.map(
        (r) => r.id,
      ),
    ).toEqual([rows[60]?.id]);
    await expect(
      owner.shopping.recipes({ pageSize: 1000 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.recipes.taggingList({ pageSize: 1000 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("measures a large fixture without timing assertions", async () => {
    const fixtureId = randomUUID();
    await db.insert(user).values({
      id: fixtureId,
      name: "Large fixture",
      email: `${fixtureId}@example.test`,
    });
    try {
      const content = {
        ...sampleRecipe,
        ingredients: Array.from(
          { length: 20 },
          (_, i) => `${i + 1} g ingredient, finely sliced for a family dinner`,
        ),
        steps: Array.from({ length: 12 }, () =>
          "Cook the ingredients gently and stir until ready. ".repeat(8),
        ),
        notes: "Batch cooking notes. ".repeat(40),
      };
      const fixture = Array.from({ length: 2000 }, (_, i) => ({
        id: randomUUID(),
        userId: fixtureId,
        title: `Large recipe ${i}`,
        origin: "manual" as const,
        content,
      }));
      for (let start = 0; start < fixture.length; start += 250)
        await db.insert(recipe).values(fixture.slice(start, start + 250));
      const api = caller(fixtureId);
      const fullStart = performance.now();
      const legacy = await db
        .select({ id: recipe.id, title: recipe.title, content: recipe.content })
        .from(recipe)
        .where(eq(recipe.userId, fixtureId));
      const fullMs = performance.now() - fullStart;
      const pageStart = performance.now();
      const page = await api.recipes.list();
      const pageMs = performance.now() - pageStart;
      const picker = await api.shopping.recipes();
      const fullBytes = Buffer.byteLength(JSON.stringify(legacy));
      const pageBytes = Buffer.byteLength(JSON.stringify(page));
      const pickerBytes = Buffer.byteLength(JSON.stringify(picker));
      expect(page.total).toBe(2000);
      expect(page.items).toHaveLength(24);
      expect(picker.items).toHaveLength(24);
      expect(pageBytes).toBeLessThan(fullBytes / 100);
      expect(pickerBytes).toBeLessThan(pageBytes);
      const query = collectionQueries(
        db,
        fixtureId,
        collectionInput.parse({}),
      ).items.toSQL();
      const plans = await db.$client.query(
        `explain (analyze, buffers, format json) ${query.sql}`,
        query.params,
      );
      const plan = z
        .array(
          z.object({
            Plan: z.object({
              "Node Type": z.string(),
              "Actual Rows": z.number(),
              Plans: z
                .array(
                  z.object({
                    "Node Type": z.string(),
                    "Actual Rows": z.number(),
                  }),
                )
                .optional(),
            }),
            "Execution Time": z.number(),
          }),
        )
        .parse(plans.rows[0]?.["QUERY PLAN"]);
      expect(plan[0]?.Plan["Node Type"]).toBe("Limit");
      expect(plan[0]?.Plan["Actual Rows"]).toBe(24);
      console.info(
        "F10 large fixture",
        JSON.stringify({
          recipes: fixture.length,
          fullBytes,
          pageBytes,
          pickerBytes,
          fullMs: Number(fullMs.toFixed(2)),
          pageMs: Number(pageMs.toFixed(2)),
          boundedQueryPlan: plan,
        }),
      );
    } finally {
      await db.delete(recipe).where(eq(recipe.userId, fixtureId));
      await db.delete(user).where(eq(user.id, fixtureId));
    }
  }, 30000);
});
