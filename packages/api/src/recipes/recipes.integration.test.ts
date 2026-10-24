import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { aiSpend, billingAccount } from "@prep-sheet/db/schema/billing";
import { household, householdInvite } from "@prep-sheet/db/schema/household";
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

// Removes every recipe and household the test accounts own.
async function cleanup() {
  await db.delete(recipe).where(inArray(recipe.userId, [...ids]));
  await db.delete(household).where(inArray(household.ownerId, [...ids]));
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
  it("rejects concurrent same-user edits, including a second conflict after review, and non-owner edits", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const shared = await owner.households.create({ name: "Concurrent edits" });
    const invite = await owner.households.invite({ householdId: shared.id });
    await member.households.acceptInvite({ token: invite.token });
    for (const householdId of [shared.id, null]) {
      const id = randomUUID();
      const created = await owner.recipes.createManual({
        id,
        householdId,
        content: sampleRecipe,
      });
      if (householdId)
        await expect(
          member.recipes.update({
            id,
            expectedRevision: created.revision,
            content: { ...sampleRecipe, title: "Member writer" },
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const results = await Promise.allSettled([
        owner.recipes.update({
          id,
          expectedRevision: created.revision,
          content: { ...sampleRecipe, title: "First writer" },
        }),
        owner.recipes.update({
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
        owner.recipes.update({
          id,
          expectedRevision: latest.revision,
          content: sampleRecipe,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await owner.recipes.get({ id })).title).toBe("Third writer");
      await owner.recipes.delete({ id });
    }
    await cleanup();
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
    await db.delete(recipe).where(inArray(recipe.userId, ids));
    await db.delete(household).where(inArray(household.ownerId, ids));
    await db.delete(user).where(inArray(user.id, ids));
    await db.$client.end();
  });
  it("keeps cooking history private, validates dates, retries safely and preserves history on deletion", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const outsider = caller(ids[3]);
    const target = await owner.households.create({
      name: "Cooking history test",
    });
    const invite = await owner.households.invite({ householdId: target.id });
    await member.households.acceptInvite({ token: invite.token });
    const id = randomUUID();
    await owner.recipes.createManual({
      id,
      householdId: target.id,
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
      (await owner.recipes.list()).items.find((r) => r.id === id),
    ).toMatchObject({ cookedCount: 2, lastCookedOn: "2026-09-01" });
    expect(await member.recipes.cookingHistory({ id })).toEqual([]);
    expect(await member.recipes.get({ id })).toMatchObject({
      cookedCount: 0,
      lastCookedOn: null,
    });
    expect(
      (await member.recipes.list()).items.find((r) => r.id === id),
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
    await owner.recipes.copy({ id, newId: copyId });
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
    await cleanup();
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
  it("keeps tags personal to the recipe owner, read-only for household members, and copies them into the copier's tags", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const outsider = caller(ids[2]);
    const shared = await owner.households.create({ name: "Shared tags" });
    const invite = await owner.households.invite({ householdId: shared.id });
    await member.households.acceptInvite({ token: invite.token });
    const memberTag = await member.tags.create({
      name: "Packed lunch",
      description: "Pack for lunch",
    });
    const ownerTag = await owner.tags.create({ name: "Owner only" });
    expect(memberTag).toMatchObject({ userId: ids[1] });
    expect(await owner.tags.list()).not.toContainEqual(memberTag);
    vi.mocked(generateRecipe).mockResolvedValueOnce({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [memberTag.id, ownerTag.id],
    });
    const imported = await createAndWait(member, {
      id: randomUUID(),
      input: "Shared packed lunch",
      householdId: shared.id,
    });
    const offeredTags = vi.mocked(generateRecipe).mock.lastCall?.[1];
    expect(offeredTags).toContainEqual(memberTag);
    expect(offeredTags).not.toContainEqual(ownerTag);
    // Members see the owner's tags read-only.
    expect(await owner.recipes.get(imported)).toMatchObject({
      tagIds: [memberTag.id],
      tags: [{ id: memberTag.id, name: "Packed lunch" }],
      isOwner: false,
    });
    const filtered = await owner.recipes.list({ tagIds: [memberTag.id] });
    expect(filtered.items.map((item) => item.id)).toEqual([imported.id]);
    expect(filtered.items[0]?.tags).toEqual([
      { id: memberTag.id, name: "Packed lunch" },
    ]);
    expect(
      (await owner.recipes.taggingList()).items.some(
        (item) => item.id === imported.id,
      ),
    ).toBe(false);
    for (const api of [owner, outsider])
      await expect(
        api.recipes.setTag({
          id: imported.id,
          tagId: memberTag.id,
          selected: false,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      member.recipes.setTag({
        id: imported.id,
        tagId: ownerTag.id,
        selected: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await member.recipes.setTags({
      recipeIds: [imported.id],
      tagIds: [memberTag.id],
      operation: "remove",
    });
    expect((await owner.recipes.get(imported)).tagIds).toEqual([]);
    await member.recipes.setTag({
      id: imported.id,
      tagId: memberTag.id,
      selected: true,
    });
    // Copying recreates the owner's tag among the copier's own tags.
    const ownCopy = await owner.recipes.copy({
      id: imported.id,
      newId: randomUUID(),
    });
    const copiedTags = (await owner.tags.list()).filter(
      (item) => item.name === memberTag.name,
    );
    expect(copiedTags).toHaveLength(1);
    const copiedTag = copiedTags[0];
    if (!copiedTag) throw new Error("Missing copied tag");
    expect(copiedTag).toMatchObject({
      userId: ids[0],
      description: memberTag.description,
    });
    expect(copiedTag.id).not.toBe(memberTag.id);
    expect((await owner.recipes.get(ownCopy)).tagIds).toEqual([copiedTag.id]);
    // Copying back reuses the member's existing tag with the same name.
    await owner.recipes.share({ id: ownCopy.id, householdId: shared.id });
    const copiedBack = await member.recipes.copy({
      id: ownCopy.id,
      newId: randomUUID(),
    });
    expect((await member.recipes.get(copiedBack)).tagIds).toEqual([
      memberTag.id,
    ]);
    await owner.households.removeMember({
      householdId: shared.id,
      userId: ids[1],
    });
    // Shares outlive the sharer's membership; the removed member loses others' recipes.
    expect((await owner.recipes.get(imported)).id).toBe(imported.id);
    await expect(member.recipes.get(ownCopy)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await member.tags.delete({ id: memberTag.id });
    expect((await member.recipes.get(imported)).tagIds).toEqual([]);
    expect((await owner.recipes.get(ownCopy)).tagIds).toEqual([copiedTag.id]);
    await owner.tags.delete({ id: copiedTag.id });
    await owner.tags.delete({ id: ownerTag.id });
    await cleanup();
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
    const input = { id: randomUUID(), content: sampleRecipe };
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
    const input = { id: randomUUID(), content: sampleRecipe };
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
    const target = await owner.households.create({
      name: "Manual recipe test",
    });
    const sharedInput = { ...input, id: randomUUID(), householdId: target.id };
    await expect(other.recipes.createManual(sharedInput)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const invite = await owner.households.invite({ householdId: target.id });
    await other.households.acceptInvite({ token: invite.token });
    const shared = await other.recipes.createManual(sharedInput);
    expect(shared.sharedWith).toMatchObject([{ id: target.id }]);
    expect((await owner.recipes.get({ id: shared.id })).content).toEqual(
      sampleRecipe,
    );
    await expect(
      owner.recipes.createManual({ ...input, householdId: target.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Saving into a collection appends the recipe; others' collections are rejected.
    const mine = await owner.collections.create({ name: "Manual saves" });
    const collected = await owner.recipes.createManual({
      ...input,
      id: randomUUID(),
      collectionId: mine.id,
    });
    expect(collected.collectionIds).toEqual([mine.id]);
    expect(
      (await owner.recipes.list({ collectionId: mine.id })).items.map(
        (r) => r.id,
      ),
    ).toEqual([collected.id]);
    await expect(
      other.recipes.createManual({
        ...input,
        id: randomUUID(),
        collectionId: mine.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(generateRecipe).not.toHaveBeenCalled();
    await cleanup();
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

  it("shares recipes with households and collections by the three access rules", async () => {
    vi.mocked(generateRecipe).mockResolvedValue({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [],
    });
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const outsider = caller(ids[2]);
    const friends = await owner.households.create({ name: "Dinner friends" });
    const separate = await outsider.households.create({
      name: "Another household",
    });
    const invitation = await owner.households.invite({
      householdId: friends.id,
    });
    expect(
      await member.households.previewInvite({ token: invitation.token }),
    ).toMatchObject({ name: "Dinner friends" });
    await member.households.acceptInvite({ token: invitation.token });
    await expect(
      outsider.households.acceptInvite({ token: invitation.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const memberHouseholds = await member.households.list();
    expect(memberHouseholds.map((item) => item.personal)).toEqual([
      true,
      false,
    ]);
    expect(memberHouseholds[1]).toMatchObject({
      id: friends.id,
      isOwner: false,
      members: [{ id: ids[0] }, { id: ids[1] }],
    });
    const memberPersonal = memberHouseholds[0];
    if (!memberPersonal) throw new Error("Missing personal household");
    await expect(
      member.households.invite({ householdId: friends.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.households.rename({ householdId: friends.id, name: "No" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.households.removeMember({
        householdId: friends.id,
        userId: ids[0],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.households.removeMember({
        householdId: friends.id,
        userId: ids[0],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      outsider.households.details({ householdId: friends.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const personal = await createAndWait(owner, {
      id: randomUUID(),
      input: "Personal pasta",
    });
    // Rule 2: shared with a household the viewer belongs to.
    const shared = await createAndWait(member, {
      id: randomUUID(),
      input: "Shared pasta",
      householdId: friends.id,
    });
    expect(await owner.recipes.get({ id: shared.id })).toMatchObject({
      isOwner: false,
      owner: { id: ids[1] },
      sharedWith: [{ id: friends.id, name: "Dinner friends" }],
    });
    expect(
      (await owner.recipes.list()).items.map((item) => item.id).sort(),
    ).toEqual([personal.id, shared.id].sort());
    expect((await member.recipes.list()).items.map((item) => item.id)).toEqual([
      shared.id,
    ]);
    await member.recipes.setFavourite({ id: shared.id, isFavourite: true });
    await member.recipes.setRating({ id: shared.id, rating: 5 });
    expect((await member.recipes.get({ id: shared.id })).isFavourite).toBe(
      true,
    );
    expect((await owner.recipes.get({ id: shared.id })).isFavourite).toBe(
      false,
    );
    expect((await owner.recipes.get({ id: shared.id })).rating).toBeNull();
    await owner.recipes.setRating({ id: shared.id, rating: 2 });
    expect((await member.recipes.get({ id: shared.id })).rating).toBe(5);
    await expect(
      outsider.recipes.setFavourite({ id: shared.id, isFavourite: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      outsider.recipes.setRating({ id: shared.id, rating: 4 }),
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
        householdId: friends.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(vi.mocked(generateRecipe).mock.calls.length).toBe(calls);
    // Only the owner edits, deletes or shares.
    await expect(
      owner.recipes.update({
        expectedRevision: 1,
        id: shared.id,
        content: { ...sampleRecipe, title: "Not mine" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.recipes.delete({ id: shared.id })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      owner.recipes.share({ id: shared.id, householdId: friends.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await member.recipes.update({
      expectedRevision: 1,
      id: shared.id,
      content: { ...sampleRecipe, title: "Everyone's pasta" },
    });
    expect((await owner.recipes.get({ id: shared.id })).title).toBe(
      "Everyone's pasta",
    );
    await expect(
      member.recipes.share({
        id: shared.id,
        householdId: memberPersonal.id,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      member.recipes.share({ id: shared.id, householdId: separate.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await member.recipes.unshare({ id: shared.id, householdId: friends.id });
    await expect(owner.recipes.get({ id: shared.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await member.recipes.share({ id: shared.id, householdId: friends.id });
    expect((await owner.recipes.get({ id: shared.id })).id).toBe(shared.id);
    const copy = await owner.recipes.copy({
      id: personal.id,
      newId: randomUUID(),
      householdId: friends.id,
    });
    expect((await member.recipes.get({ id: copy.id })).content).toEqual(
      personal.content,
    );
    await expect(
      member.recipes.copy({
        id: shared.id,
        newId: randomUUID(),
        householdId: separate.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Rule 3: a shared collection exposes only the collection owner's recipes.
    const tasting = await owner.households.create({ name: "Tasting" });
    const tastingInvite = await owner.households.invite({
      householdId: tasting.id,
    });
    await outsider.households.acceptInvite({ token: tastingInvite.token });
    const favourites = await owner.collections.create({ name: "Favourites" });
    await owner.collections.addRecipes({
      collectionId: favourites.id,
      recipeIds: [personal.id, shared.id],
    });
    await expect(
      outsider.recipes.list({ collectionId: favourites.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.collections.share({
      collectionId: favourites.id,
      householdId: tasting.id,
    });
    expect(
      (await outsider.collections.list()).find(
        (item) => item.id === favourites.id,
      ),
    ).toMatchObject({
      isOwner: false,
      owner: { id: ids[0] },
      recipeCount: 1,
      sharedWith: [{ id: tasting.id }],
    });
    expect(
      (await outsider.recipes.list({ collectionId: favourites.id })).items.map(
        (item) => item.id,
      ),
    ).toEqual([personal.id]);
    expect((await outsider.recipes.get({ id: personal.id })).isOwner).toBe(
      false,
    );
    await expect(outsider.recipes.get({ id: shared.id })).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    await expect(
      outsider.collections.addRecipes({
        collectionId: favourites.id,
        recipeIds: [personal.id],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.collections.unshare({
      collectionId: favourites.id,
      householdId: tasting.id,
    });
    await expect(
      outsider.recipes.get({ id: personal.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Removal revokes household access but leaves the member's own recipes.
    await owner.households.removeMember({
      householdId: friends.id,
      userId: ids[1],
    });
    await expect(
      member.recipes.setFavourite({ id: copy.id, isFavourite: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(member.recipes.get({ id: copy.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await member.households.list()).toHaveLength(1);
    expect((await member.recipes.get({ id: shared.id })).isOwner).toBe(true);
    await cleanup();
  });

  it("expires and revokes invitations and accepts a link only once under concurrency", async () => {
    const owner = caller(ids[0]);
    const target = await owner.households.create({ name: "Invitation checks" });
    const expired = await owner.households.invite({ householdId: target.id });
    await db
      .update(householdInvite)
      .set({ expiresAt: new Date(0) })
      .where(eq(householdInvite.householdId, target.id));
    await expect(
      caller(ids[1]).households.acceptInvite({ token: expired.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const revoked = await owner.households.invite({ householdId: target.id });
    const detail = await owner.households.details({ householdId: target.id });
    const inviteId = detail.invites[0]?.id;
    if (!inviteId) throw new Error("Missing invite");
    await owner.households.revokeInvite({ householdId: target.id, inviteId });
    await expect(
      caller(ids[1]).households.acceptInvite({ token: revoked.token }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const concurrent = await owner.households.invite({
      householdId: target.id,
    });
    const results = await Promise.allSettled([
      caller(ids[1]).households.acceptInvite({ token: concurrent.token }),
      caller(ids[2]).households.acceptInvite({ token: concurrent.token }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const members = (await owner.households.details({ householdId: target.id }))
      .members;
    expect(members).toHaveLength(2);
    const joined = members.find((member) => member.id !== ids[0]);
    if (!joined) throw new Error("Missing member");
    await caller(joined.id).households.leave({ householdId: target.id });
    expect(
      (await owner.households.details({ householdId: target.id })).members,
    ).toHaveLength(1);
    await cleanup();
  });

  it("rechecks membership after generation and keeps shared recipes when an account is deleted", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[3]);
    const target = await owner.households.create({ name: "Membership checks" });
    const invite = await owner.households.invite({ householdId: target.id });
    await member.households.acceptInvite({ token: invite.token });
    vi.mocked(generateRecipe).mockResolvedValue({
      content: sampleRecipe,
      origin: "generated",
      sourceUrl: null,
      tagIds: [],
    });
    const saved = await createAndWait(member, {
      id: randomUUID(),
      input: "Keep this recipe",
      householdId: target.id,
    });
    vi.mocked(generateRecipe).mockImplementationOnce(async () => {
      await owner.households.removeMember({
        householdId: target.id,
        userId: ids[3],
      });
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
        householdId: target.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await owner.recipes.list()).items.map((r) => r.id)).toEqual([
      saved.id,
    ]);
    await db.delete(household).where(eq(household.ownerId, ids[3]));
    await db.delete(user).where(eq(user.id, ids[3]));
    expect(await owner.recipes.get({ id: saved.id })).toMatchObject({
      userId: null,
      owner: null,
      isOwner: false,
    });
    await db.delete(recipe).where(eq(recipe.id, saved.id));
    await cleanup();
  });

  it("transfers ownership, protects personal households and keeps recipes when a household is deleted", async () => {
    const owner = caller(ids[0]);
    const member = caller(ids[1]);
    const [justMe] = await owner.households.list();
    if (!justMe?.personal) throw new Error("Missing personal household");
    expect(justMe).toMatchObject({ name: "Just me", color: "sage" });
    for (const request of [
      () => owner.households.rename({ householdId: justMe.id, name: "Mine" }),
      () => owner.households.invite({ householdId: justMe.id }),
      () => owner.households.leave({ householdId: justMe.id }),
      () =>
        owner.households.delete({ householdId: justMe.id, name: "Just me" }),
    ])
      await expect(request()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.households.recolor({ householdId: justMe.id, color: "plum" });
    const target = await owner.households.create({
      name: "Household lifecycle",
    });
    const invite = await owner.households.invite({ householdId: target.id });
    await member.households.acceptInvite({ token: invite.token });
    await owner.households.rename({
      householdId: target.id,
      name: "Renamed household",
    });
    expect(
      (await member.households.details({ householdId: target.id })).name,
    ).toBe("Renamed household");
    await expect(
      owner.households.leave({ householdId: target.id }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      member.households.delete({
        householdId: target.id,
        name: "Renamed household",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      member.households.transferOwnership({
        householdId: target.id,
        userId: ids[1],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      owner.households.transferOwnership({
        householdId: target.id,
        userId: ids[2],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.households.transferOwnership({
      householdId: target.id,
      userId: ids[1],
    });
    await expect(
      owner.households.invite({ householdId: target.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.households.leave({ householdId: target.id });
    await expect(
      owner.households.details({ householdId: target.id }),
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
      householdId: target.id,
    });
    await expect(
      member.households.delete({ householdId: target.id, name: "Wrong name" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await member.households.delete({
      householdId: target.id,
      name: "Renamed household",
    });
    expect(await member.recipes.get({ id: shared.id })).toMatchObject({
      title: sampleRecipe.title,
      sharedWith: [],
    });
    await cleanup();
  });
});
