import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { group, groupInvite } from "@prep-sheet/db/schema/group";
import { recipeImport } from "@prep-sheet/db/schema/import";
import {
  recipe,
  recipeCooking,
  recipeFavourite,
  recipeRating,
} from "@prep-sheet/db/schema/recipe";
import { TRPCError } from "@trpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Context } from "../context";
import { processNextImport } from "../imports";
import { appRouter } from "../routers/index";
import { sampleRecipe } from "./fixtures";
import { generateRecipe } from "./generate";

vi.mock("./generate", async (original) => ({
  ...(await original<typeof import("./generate")>()),
  generateRecipe: vi.fn(),
}));

const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Recipe test",
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

async function createAndWait(
  api: ReturnType<typeof caller>,
  input: Parameters<ReturnType<typeof caller>["recipes"]["create"]>[0],
) {
  const status = await api.recipes.create(input);
  if (status.kind !== "saved") await processNextImport();
  const result = await api.recipes.importStatus({ id: input.id });
  if (result.kind === "failed")
    throw new TRPCError({ code: "NOT_FOUND", message: result.message });
  return api.recipes.get({ id: input.id });
}

describe("recipes API with PostgreSQL", () => {
  it("rejects concurrent shared and same-user edits, including a second conflict after review", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const shared = await owner.groups.create({ name: "Concurrent edits" });
    const invite = await owner.groups.invite({ groupId: shared.id });
    await member.groups.acceptInvite({ token: invite.token });
    for (const groupId of [shared.id, null]) {
      const id = randomUUID();
      const created = await owner.recipes.createManual({
        id,
        groupId,
        content: sampleRecipe,
      });
      const secondEditor = groupId ? member : owner;
      const results = await Promise.allSettled([
        owner.recipes.update({
          id,
          expectedRevision: created.revision,
          content: { ...sampleRecipe, title: "First writer" },
        }),
        secondEditor.recipes.update({
          id,
          expectedRevision: created.revision,
          content: { ...sampleRecipe, title: "Second writer" },
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.find((result) => result.status === "rejected"),
      ).toMatchObject({ reason: { code: "CONFLICT" } });
      const latest = await owner.recipes.get({ id });
      expect(latest.revision).toBe(created.revision + 1);
      await owner.recipes.update({
        id,
        expectedRevision: latest.revision,
        content: { ...sampleRecipe, title: "Third writer" },
      });
      await expect(
        secondEditor.recipes.update({
          id,
          expectedRevision: latest.revision,
          content: sampleRecipe,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await owner.recipes.get({ id })).title).toBe("Third writer");
      await owner.recipes.delete({ id });
    }
    await db.delete(group).where(eq(group.id, shared.id));
  });
  beforeAll(async () => {
    await db.insert(user).values(
      ids.map((id) => ({
        id,
        name: "Recipe test",
        email: `${id}@example.test`,
      })),
    );
    await db.insert(billingAccount).values(
      ids.map((userId) => ({
        userId,
        status: "active",
        validUntil: new Date(Date.now() + 86400000),
      })),
    );
  });
  afterAll(async () => {
    await db
      .delete(aiSpend)
      .where(
        inArray(
          aiSpend.importId,
          db
            .select({ id: recipeImport.id })
            .from(recipeImport)
            .where(inArray(recipeImport.userId, ids)),
        ),
      );
    await db.delete(group).where(inArray(group.ownerId, ids));
    await db.delete(recipe).where(inArray(recipe.userId, ids));
    await db.delete(user).where(inArray(user.id, ids));
    await db.$client.end();
  });
  it("keeps cooking history private, validates dates, retries safely and preserves history on deletion", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const outsider = caller(ids[3]);
    const target = await owner.groups.create({ name: "Cooking history test" });
    const invite = await owner.groups.invite({ groupId: target.id });
    await member.groups.acceptInvite({ token: invite.token });
    const id = randomUUID();
    await owner.recipes.createManual({
      id,
      groupId: target.id,
      content: sampleRecipe,
    });
    const entry = {
      id,
      entryId: randomUUID(),
      cookedOn: "2026-09-01",
      note: "Less salt next time",
    };
    await owner.recipes.saveCooking(entry);
    await owner.recipes.saveCooking(entry);
    await owner.recipes.saveCooking({
      id,
      entryId: randomUUID(),
      cookedOn: null,
      note: "",
    });
    expect(await owner.recipes.cookingHistory({ id })).toHaveLength(2);
    expect(await owner.recipes.get({ id })).toMatchObject({
      cookedCount: 2,
      lastCookedOn: "2026-09-01",
    });
    expect(
      (await owner.recipes.list({ groupId: target.id })).items.find(
        (r) => r.id === id,
      ),
    ).toMatchObject({ cookedCount: 2, lastCookedOn: "2026-09-01" });
    expect(await member.recipes.cookingHistory({ id })).toEqual([]);
    expect(await member.recipes.get({ id })).toMatchObject({
      cookedCount: 0,
      lastCookedOn: null,
    });
    expect(
      (await member.recipes.list({ groupId: target.id })).items.find(
        (r) => r.id === id,
      ),
    ).toMatchObject({ cookedCount: 0, lastCookedOn: null });
    await expect(
      member.recipes.saveCooking({ ...entry, note: "Hijacked" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await member.recipes.deleteCooking({ id, entryId: entry.entryId });
    expect((await owner.recipes.cookingHistory({ id }))[0]?.note).toBe(
      entry.note,
    );
    await expect(outsider.recipes.cookingHistory({ id })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(
      outsider.recipes.saveCooking({ ...entry, entryId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.recipes.deleteCooking({ id, entryId: entry.entryId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.recipes.saveCooking({ ...entry, cookedOn: "2026-02-30" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      owner.recipes.saveCooking({ ...entry, note: "x".repeat(5001) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.recipes.saveCooking({
      ...entry,
      cookedOn: "2026-08-01",
      note: "Updated",
    });
    expect(await owner.recipes.get({ id })).toMatchObject({
      lastCookedOn: "2026-08-01",
      content: sampleRecipe,
    });
    const copyId = randomUUID();
    await owner.recipes.copy({ id, newId: copyId, groupId: null });
    expect(await owner.recipes.cookingHistory({ id: copyId })).toEqual([]);
    await owner.recipes.delete({ id: copyId });
    await owner.recipes.deleteCooking({ id, entryId: entry.entryId });
    expect(await owner.recipes.get({ id })).toMatchObject({
      cookedCount: 1,
      lastCookedOn: null,
    });
    await owner.recipes.delete({ id });
    expect(
      await db
        .select()
        .from(recipeCooking)
        .where(eq(recipeCooking.recipeId, id)),
    ).toHaveLength(1);
    await owner.recipes.restore({ id });
    expect(await owner.recipes.cookingHistory({ id })).toHaveLength(1);
    await db.delete(group).where(eq(group.id, target.id));
  });
  it("requires authentication", async () => {
    await expect(
      appRouter.createCaller({ auth: null, session: null }).recipes.list(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("passes available tags to AI, saves valid personal tags, copies them and cascades deletion", async () => {
    const owner = caller(ids[2]);
    const other = caller(ids[3]);
    const defaults = await owner.tags.list();
    expect(defaults).toHaveLength(5);
    const builtIn = defaults[0];
    if (!builtIn) throw new Error("Missing built-in tags");
    const custom = await owner.tags.create({
      name: "Lunchbox",
      description: "Easy to pack",
    });
    const renamed = await owner.tags.update({
      id: custom.id,
      name: "Lunch kit",
      description: "Easy to pack and eat cold",
    });
    expect(renamed).toMatchObject({
      name: "Lunch kit",
      description: "Easy to pack and eat cold",
    });
    await expect(
      owner.tags.create({ name: " lunch KIT " }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      owner.tags.update({ ...renamed, name: builtIn.name }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      other.tags.update({
        id: custom.id,
        name: "Not mine",
        description: "",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.tags.update({
        id: builtIn.id,
        name: "Built in edit",
        description: "",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.tags.create({ name: " lunchBOX " }),
    ).resolves.toMatchObject({ name: "lunchBOX" });
    expect((await other.tags.list()).some((t) => t.id === custom.id)).toBe(
      false,
    );
    await expect(other.tags.delete({ id: custom.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(owner.tags.delete({ id: builtIn.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const foreign = await other.tags.create({ name: "Private" });
    const id = randomUUID();
    vi.mocked(generateRecipe).mockResolvedValueOnce({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [custom.id, foreign.id, randomUUID()],
    });
    await createAndWait(owner, { id, input: "Make lunch" });
    expect(generateRecipe).toHaveBeenLastCalledWith(
      "Make lunch",
      expect.arrayContaining([
        expect.objectContaining({
          id: custom.id,
          name: "Lunch kit",
          description: "Easy to pack and eat cold",
        }),
      ]),
      undefined,
    );
    expect((await owner.recipes.get({ id })).tagIds).toEqual([custom.id]);
    expect(
      (await owner.recipes.list()).items.find((r) => r.id === id)?.tagIds,
    ).toEqual([custom.id]);
    await expect(
      other.recipes.setTag({ id, tagId: foreign.id, selected: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      owner.recipes.setTag({ id, tagId: foreign.id, selected: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.recipes.setTag({ id, tagId: custom.id, selected: false });
    expect((await owner.recipes.get({ id })).tagIds).toEqual([]);
    await owner.recipes.setTag({ id, tagId: custom.id, selected: true });
    await owner.recipes.setTag({ id, tagId: custom.id, selected: true });
    const copied = await owner.recipes.copy({
      id,
      newId: randomUUID(),
      groupId: null,
    });
    expect((await owner.recipes.get(copied)).tagIds).toEqual([custom.id]);
    expect(
      (await owner.recipes.taggingList()).items.filter((item) =>
        [id, copied.id].includes(item.id),
      ),
    ).toHaveLength(2);
    await owner.recipes.setTags({
      recipeIds: [id, copied.id],
      tagIds: [custom.id],
      operation: "remove",
    });
    expect((await owner.recipes.get({ id })).tagIds).toEqual([]);
    expect((await owner.recipes.get(copied)).tagIds).toEqual([]);
    await owner.recipes.setTags({
      recipeIds: [id, copied.id, copied.id],
      tagIds: [custom.id, builtIn.id],
      operation: "add",
    });
    expect((await owner.recipes.get({ id })).tagIds).toEqual(
      expect.arrayContaining([custom.id, builtIn.id]),
    );
    await expect(
      owner.recipes.setTags({
        recipeIds: [id],
        tagIds: [foreign.id],
        operation: "add",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      other.recipes.setTags({
        recipeIds: [id],
        tagIds: [foreign.id],
        operation: "add",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.recipes.setTags({
      recipeIds: [id, copied.id],
      tagIds: [builtIn.id],
      operation: "remove",
    });
    await owner.tags.delete({ id: custom.id });
    expect((await owner.recipes.get({ id })).tagIds).toEqual([]);
    expect((await owner.recipes.get(copied)).tagIds).toEqual([]);
    await owner.recipes.delete({ id });
    await owner.recipes.delete(copied);
    vi.mocked(generateRecipe).mockClear();
  });
  it("saves JSONB, avoids duplicate saves, isolates users, edits and deletes", async () => {
    const owner = caller(ids[0]);
    const other = caller(ids[1]);
    const id = randomUUID();
    vi.mocked(generateRecipe).mockResolvedValue({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [],
    });
    const saved = await createAndWait(owner, { id, input: "Make lemon pasta" });
    expect(saved.content.ingredients).toEqual(sampleRecipe.ingredients);
    await createAndWait(owner, { id, input: "Make lemon pasta" });
    expect(generateRecipe).toHaveBeenCalledTimes(1);
    expect((await owner.recipes.list()).items).toHaveLength(1);
    expect((await other.recipes.list()).items).toHaveLength(0);
    await expect(other.recipes.get({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      other.recipes.update({ expectedRevision: 1, id, content: sampleRecipe }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.recipes.delete({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await owner.recipes.update({
      expectedRevision: 1,
      id,
      content: { ...sampleRecipe, title: "My lemon pasta" },
    });
    expect((await owner.recipes.get({ id })).title).toBe("My lemon pasta");
    await owner.recipes.delete({ id });
    await expect(owner.recipes.get({ id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
  it("does not save anything when generation fails", async () => {
    vi.mocked(generateRecipe).mockRejectedValueOnce(
      new Error("upstream unavailable"),
    );
    const owner = caller(ids[0]);
    await expect(
      createAndWait(owner, { id: randomUUID(), input: "Make dinner" }),
    ).rejects.toThrow();
    expect((await owner.recipes.list()).items).toHaveLength(0);
  });

  it("binds manual retries to their immutable submission, including concurrent and legacy requests", async () => {
    const api = caller(ids[0]);
    const input = { id: randomUUID(), groupId: null, content: sampleRecipe };
    // A lost response is equivalent to dropping this first successful return value.
    await api.recipes.createManual(input);
    await expect(
      api.recipes.createManual({
        ...input,
        content: { ...sampleRecipe, title: "Newer draft" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await api.recipes.get({ id: input.id })).content).toEqual(
      sampleRecipe,
    );
    await api.recipes.update({
      id: input.id,
      expectedRevision: 1,
      content: { ...sampleRecipe, notes: "Edited after creation" },
    });
    const recovered = await api.recipes.createManual(input);
    expect(recovered.revision).toBe(2);
    expect(recovered.content.notes).toBe("Edited after creation");
    await expect(
      api.recipes.createManual({ ...input, content: recovered.content }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const concurrent = { ...input, id: randomUUID() };
    const attempts = await Promise.allSettled([
      api.recipes.createManual(concurrent),
      api.recipes.createManual({
        ...concurrent,
        content: { ...sampleRecipe, title: "Racing draft" },
      }),
    ]);
    expect(
      attempts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.find((result) => result.status === "rejected"),
    ).toMatchObject({ reason: { code: "CONFLICT" } });
    const legacy = { ...input, id: randomUUID() };
    await db.insert(recipe).values({
      id: legacy.id,
      userId: ids[0],
      title: sampleRecipe.title,
      content: sampleRecipe,
      origin: "manual",
    });
    await expect(api.recipes.createManual(legacy)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await db
      .delete(recipe)
      .where(inArray(recipe.id, [input.id, concurrent.id, legacy.id]));
  });

  it("saves manual recipes without AI, validates content and protects collections", async () => {
    const owner = caller(ids[0]);
    const other = caller(ids[1]);
    const input = { id: randomUUID(), groupId: null, content: sampleRecipe };
    vi.mocked(generateRecipe).mockClear();
    vi.mocked(generateRecipe).mockRejectedValue(new Error("AI unavailable"));
    const saved = await owner.recipes.createManual(input);
    expect(saved).toMatchObject({
      origin: "manual",
      sourceUrl: null,
      content: sampleRecipe,
    });
    expect((await owner.recipes.createManual(input)).id).toBe(saved.id);
    expect(
      (await owner.recipes.list()).items.filter((r) => r.id === saved.id),
    ).toHaveLength(1);
    await expect(other.recipes.get({ id: saved.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(other.recipes.createManual(input)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      appRouter
        .createCaller({ auth: null, session: null })
        .recipes.createManual(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    for (const content of [
      { ...sampleRecipe, title: " " },
      { ...sampleRecipe, ingredients: [] },
      { ...sampleRecipe, steps: [] },
    ]) {
      await expect(
        owner.recipes.createManual({ ...input, id: randomUUID(), content }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const target = await owner.groups.create({ name: "Manual recipe test" });
    const sharedInput = { ...input, id: randomUUID(), groupId: target.id };
    await expect(other.recipes.createManual(sharedInput)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const invite = await owner.groups.invite({ groupId: target.id });
    await other.groups.acceptInvite({ token: invite.token });
    const shared = await other.recipes.createManual(sharedInput);
    expect((await owner.recipes.get({ id: shared.id })).content).toEqual(
      sampleRecipe,
    );
    await expect(
      owner.recipes.createManual({ ...input, groupId: target.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(generateRecipe).not.toHaveBeenCalled();
    await db.delete(group).where(eq(group.id, target.id));
    await owner.recipes.delete({ id: saved.id });
  });

  it("persists personal favourites and rejects inaccessible recipes", async () => {
    const owner = caller(ids[0]);
    const other = caller(ids[1]);
    const id = randomUUID();
    await db.insert(recipe).values({
      id,
      userId: ids[0],
      title: sampleRecipe.title,
      content: sampleRecipe,
      origin: "imported",
    });
    expect((await owner.recipes.get({ id })).isFavourite).toBe(false);
    await expect(
      other.recipes.setFavourite({ id, isFavourite: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.recipes.setFavourite({ id, isFavourite: true });
    await owner.recipes.setFavourite({ id, isFavourite: true });
    expect((await owner.recipes.get({ id })).isFavourite).toBe(true);
    expect(
      (await owner.recipes.list()).items.find((item) => item.id === id)
        ?.isFavourite,
    ).toBe(true);
    await owner.recipes.setFavourite({ id, isFavourite: false });
    expect((await owner.recipes.get({ id })).isFavourite).toBe(false);
    await owner.recipes.setFavourite({ id, isFavourite: true });
    await owner.recipes.delete({ id });
    expect(
      await db
        .select()
        .from(recipeFavourite)
        .where(eq(recipeFavourite.recipeId, id)),
    ).toHaveLength(1);
    await owner.recipes.restore({ id });
    expect((await owner.recipes.get({ id })).isFavourite).toBe(true);
    await owner.recipes.delete({ id });
  });
  it("persists personal ratings and rejects inaccessible recipes", async () => {
    const owner = caller(ids[0]);
    const other = caller(ids[1]);
    const id = randomUUID();
    await db.insert(recipe).values({
      id,
      userId: ids[0],
      title: sampleRecipe.title,
      content: sampleRecipe,
      origin: "imported",
    });
    expect((await owner.recipes.get({ id })).rating).toBeNull();
    await expect(
      other.recipes.setRating({ id, rating: 4 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.recipes.setRating({ id, rating: 4 });
    await owner.recipes.setRating({ id, rating: 5 });
    expect((await owner.recipes.get({ id })).rating).toBe(5);
    expect(
      (await owner.recipes.list()).items.find((item) => item.id === id)?.rating,
    ).toBe(5);
    expect((await other.recipes.list()).items).toHaveLength(0);
    await owner.recipes.setRating({ id, rating: null });
    expect((await owner.recipes.get({ id })).rating).toBeNull();
    await expect(
      owner.recipes.setRating({ id, rating: 6 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.recipes.setRating({ id, rating: 3 });
    await owner.recipes.delete({ id });
    expect(
      await db.select().from(recipeRating).where(eq(recipeRating.recipeId, id)),
    ).toHaveLength(1);
    await owner.recipes.restore({ id });
    expect((await owner.recipes.get({ id })).rating).toBe(3);
    await owner.recipes.delete({ id });
  });
  it("validates edits before touching the database", async () => {
    await expect(
      caller(ids[0]).recipes.update({
        expectedRevision: 1,
        id: randomUUID(),
        content: { ...sampleRecipe, steps: [] },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await db.select().from(user).where(eq(user.id, ids[0])),
    ).toHaveLength(1);
  });

  it("shares a group collection while keeping personal and other groups private", async () => {
    vi.mocked(generateRecipe).mockResolvedValue({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [],
    });
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const outsider = caller(ids[2]);
    const friends = await owner.groups.create({ name: "Dinner friends" });
    const separate = await outsider.groups.create({ name: "Another group" });
    const invitation = await owner.groups.invite({ groupId: friends.id });
    expect(
      await member.groups.previewInvite({ token: invitation.token }),
    ).toEqual({ name: "Dinner friends" });
    await member.groups.acceptInvite({ token: invitation.token });
    await expect(
      outsider.groups.acceptInvite({ token: invitation.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await member.groups.list()).toHaveLength(1);
    await expect(
      member.groups.invite({ groupId: friends.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.groups.rename({ groupId: friends.id, name: "No" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.groups.removeMember({ groupId: friends.id, userId: ids[0] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.groups.removeMember({ groupId: friends.id, userId: ids[0] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      outsider.groups.details({ groupId: friends.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const personal = await createAndWait(owner, {
      id: randomUUID(),
      input: "Personal pasta",
    });
    const shared = await createAndWait(member, {
      id: randomUUID(),
      input: "Shared pasta",
      groupId: friends.id,
    });
    expect(
      (await owner.recipes.list({ groupId: friends.id })).items,
    ).toHaveLength(1);
    await member.recipes.setFavourite({ id: shared.id, isFavourite: true });
    await member.recipes.setRating({ id: shared.id, rating: 5 });
    const sharedTag = (await member.tags.list())[0];
    if (!sharedTag) throw new Error("Missing default tag");
    await member.recipes.setTag({
      id: shared.id,
      tagId: sharedTag.id,
      selected: true,
    });
    expect((await member.recipes.get({ id: shared.id })).tagIds).toEqual([
      sharedTag.id,
    ]);
    expect((await owner.recipes.get({ id: shared.id })).tagIds).toEqual([]);
    expect((await member.recipes.get({ id: shared.id })).isFavourite).toBe(
      true,
    );
    expect((await owner.recipes.get({ id: shared.id })).isFavourite).toBe(
      false,
    );
    expect((await member.recipes.get({ id: shared.id })).rating).toBe(5);
    expect((await owner.recipes.get({ id: shared.id })).rating).toBeNull();
    expect(
      (await member.recipes.list({ groupId: friends.id })).items[0]
        ?.isFavourite,
    ).toBe(true);
    await expect(
      outsider.recipes.setFavourite({ id: shared.id, isFavourite: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.recipes.setRating({ id: shared.id, rating: 4 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await member.recipes.list()).items).toHaveLength(0);
    expect((await owner.recipes.list()).items).toHaveLength(1);
    expect(
      (await outsider.recipes.list({ groupId: separate.id })).items,
    ).toHaveLength(0);
    await expect(
      outsider.recipes.list({ groupId: friends.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(member.recipes.get({ id: personal.id })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(outsider.recipes.get({ id: shared.id })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(
      outsider.recipes.update({
        expectedRevision: 1,
        id: shared.id,
        content: sampleRecipe,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.recipes.delete({ id: shared.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const calls = vi.mocked(generateRecipe).mock.calls.length;
    await expect(
      createAndWait(outsider, {
        id: randomUUID(),
        input: "Unauthorised import",
        groupId: friends.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(vi.mocked(generateRecipe).mock.calls.length).toBe(calls);
    await owner.recipes.update({
      expectedRevision: 1,
      id: shared.id,
      content: { ...sampleRecipe, title: "Everyone's pasta" },
    });
    expect((await member.recipes.get({ id: shared.id })).title).toBe(
      "Everyone's pasta",
    );
    const copy = await owner.recipes.copy({
      id: personal.id,
      newId: randomUUID(),
      groupId: friends.id,
    });
    expect((await member.recipes.get({ id: copy.id })).content).toEqual(
      personal.content,
    );
    await expect(
      member.recipes.copy({
        id: shared.id,
        newId: randomUUID(),
        groupId: separate.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.groups.removeMember({ groupId: friends.id, userId: ids[1] });
    await expect(
      member.recipes.setTag({
        id: shared.id,
        tagId: sharedTag.id,
        selected: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.recipes.setFavourite({ id: shared.id, isFavourite: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.recipes.setRating({ id: shared.id, rating: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await member.groups.list()).toHaveLength(0);
    await expect(member.recipes.get({ id: shared.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      member.recipes.update({
        expectedRevision: 1,
        id: shared.id,
        content: sampleRecipe,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.recipes.delete({ id: shared.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await owner.recipes.get({ id: shared.id })).id).toBe(shared.id);
    await owner.recipes.delete({ id: shared.id });
    await owner.recipes.delete({ id: personal.id });
  });

  it("expires and revokes invitations and accepts a link only once under concurrency", async () => {
    const owner = caller(ids[0]);
    const target = await owner.groups.create({ name: "Invitation checks" });
    const expired = await owner.groups.invite({ groupId: target.id });
    await db
      .update(groupInvite)
      .set({ expiresAt: new Date(0) })
      .where(eq(groupInvite.groupId, target.id));
    await expect(
      caller(ids[1]).groups.acceptInvite({ token: expired.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const revoked = await owner.groups.invite({ groupId: target.id });
    const detail = await owner.groups.details({ groupId: target.id });
    const inviteId = detail.invites[0]?.id;
    if (!inviteId) throw new Error("Missing invite");
    await owner.groups.revokeInvite({ groupId: target.id, inviteId });
    await expect(
      caller(ids[1]).groups.acceptInvite({ token: revoked.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const concurrent = await owner.groups.invite({ groupId: target.id });
    const results = await Promise.allSettled([
      caller(ids[1]).groups.acceptInvite({ token: concurrent.token }),
      caller(ids[2]).groups.acceptInvite({ token: concurrent.token }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      (await owner.groups.details({ groupId: target.id })).members,
    ).toHaveLength(2);
    const members = (await owner.groups.details({ groupId: target.id }))
      .members;
    const joined = members.find((member) => member.id !== ids[0]);
    if (!joined) throw new Error("Missing member");
    await caller(joined.id).groups.removeMember({
      groupId: target.id,
      userId: joined.id,
    });
    expect(
      (await owner.groups.details({ groupId: target.id })).members,
    ).toHaveLength(1);
  });

  it("rechecks membership after generation and keeps contributions when an account is deleted", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[3]);
    const target = await owner.groups.create({ name: "Membership checks" });
    const invite = await owner.groups.invite({ groupId: target.id });
    await member.groups.acceptInvite({ token: invite.token });
    vi.mocked(generateRecipe).mockResolvedValue({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [],
    });
    const saved = await createAndWait(member, {
      id: randomUUID(),
      input: "Keep this recipe",
      groupId: target.id,
    });
    vi.mocked(generateRecipe).mockImplementationOnce(async () => {
      await owner.groups.removeMember({ groupId: target.id, userId: ids[3] });
      return {
        content: sampleRecipe,
        origin: "generated",
        sourceUrl: null,
        tagIds: [],
      };
    });
    await expect(
      createAndWait(member, {
        id: randomUUID(),
        input: "Removed during generation",
        groupId: target.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      (await owner.recipes.list({ groupId: target.id })).items,
    ).toHaveLength(1);
    await db.delete(user).where(eq(user.id, ids[3]));
    expect((await owner.recipes.get({ id: saved.id })).userId).toBeNull();
  });

  it("transfers ownership and blocks group deletion until recipe recovery expires", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const target = await owner.groups.create({ name: "Group lifecycle" });
    const invite = await owner.groups.invite({ groupId: target.id });
    await member.groups.acceptInvite({ token: invite.token });
    await owner.groups.rename({ groupId: target.id, name: "Renamed group" });
    expect((await member.groups.details({ groupId: target.id })).name).toBe(
      "Renamed group",
    );
    await expect(
      member.groups.delete({ groupId: target.id, name: "Renamed group" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.groups.transferOwnership({ groupId: target.id, userId: ids[1] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.groups.transferOwnership({ groupId: target.id, userId: ids[2] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.groups.transferOwnership({
      groupId: target.id,
      userId: ids[1],
    });
    await expect(
      owner.groups.invite({ groupId: target.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.groups.removeMember({ groupId: target.id, userId: ids[0] });
    await expect(
      owner.groups.details({ groupId: target.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.mocked(generateRecipe).mockResolvedValue({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [],
    });
    const shared = await createAndWait(member, {
      id: randomUUID(),
      input: "Shared fixture",
      groupId: target.id,
    });
    const personal = await member.recipes.copy({
      id: shared.id,
      newId: randomUUID(),
      groupId: null,
    });
    await expect(
      member.groups.delete({ groupId: target.id, name: "Wrong name" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      member.groups.delete({ groupId: target.id, name: "Renamed group" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await member.recipes.delete({ id: shared.id });
    await expect(
      member.groups.delete({ groupId: target.id, name: "Renamed group" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await db
      .update(recipe)
      .set({
        deletedAt: new Date(Date.now() - 31 * 86400000),
        expiresAt: new Date(Date.now() - 86400000),
      })
      .where(eq(recipe.id, shared.id));
    await member.groups.delete({ groupId: target.id, name: "Renamed group" });
    await expect(member.recipes.get({ id: shared.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await member.recipes.get({ id: personal.id })).title).toBe(
      sampleRecipe.title,
    );
    await member.recipes.delete({ id: personal.id });
  });
});
