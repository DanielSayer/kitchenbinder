import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { tag } from "@prep-sheet/db/schema/tag";
import { eq, inArray, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "./context";
import { tagsRouter } from "./routers/tags";

const userIds: string[] = [];
const globalIds: string[] = [];
let userId: string;

function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Tag test",
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
  return tagsRouter.createCaller({ auth: null, session });
}

async function createUser() {
  const id = randomUUID();
  userIds.push(id);
  await db
    .insert(user)
    .values({ id, name: "Tag test", email: `${id}@example.test` });
  return id;
}

async function fillCustomTags(total: number) {
  await db.insert(tag).values(
    Array.from({ length: total }, (_, index) => ({
      id: randomUUID(),
      userId,
      name: `Existing ${index}`,
    })),
  );
}

const conflict = {
  code: "CONFLICT",
  message: "A tag with that name already exists.",
};
const missing = { code: "NOT_FOUND", message: "Custom tag not found." };

describe("tag admission and ownership with PostgreSQL", () => {
  beforeEach(async () => {
    userId = await createUser();
  });
  afterAll(async () => {
    if (globalIds.length)
      await db.delete(tag).where(inArray(tag.id, globalIds));
    await db.delete(user).where(inArray(user.id, userIds));
    await db.$client.end();
  });

  it("initializes defaults on concurrent first use and keeps their IDs stable", async () => {
    const api = caller(userId);
    const lists = await Promise.all(
      Array.from({ length: 12 }, () => api.list()),
    );
    const first = lists[0];
    expect(first).toHaveLength(5);
    for (const list of lists) expect(list).toEqual(first);
    expect(await api.list()).toEqual(first);
    expect(await db.select().from(tag).where(isNull(tag.userId))).toHaveLength(
      5,
    );
  });

  it("admits exactly one of twelve concurrent requests for the final custom slot", async () => {
    await fillCustomTags(99);
    const api = caller(userId);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        api.create({ name: `Final ${index}` }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const failures = results.filter((result) => result.status === "rejected");
    expect(failures).toHaveLength(11);
    for (const failure of failures)
      expect(failure.reason).toMatchObject({
        code: "BAD_REQUEST",
        message: "You can create up to 100 custom tags.",
      });
    expect(
      await db.select().from(tag).where(eq(tag.userId, userId)),
    ).toHaveLength(100);
    const winner = results.find((result) => result.status === "fulfilled");
    if (winner?.status !== "fulfilled") throw new Error("Missing admitted tag");
    await api.delete({ id: winner.value.id });
    await expect(api.create({ name: "Replacement" })).resolves.toMatchObject({
      userId,
    });
  });

  it("counts custom tags independently of the number of global tags", async () => {
    const id = randomUUID();
    globalIds.push(id);
    await db.insert(tag).values({ id, name: `Global ${id}` });
    await fillCustomTags(99);
    const api = caller(userId);
    await expect(api.create({ name: "Hundredth" })).resolves.toMatchObject({
      userId,
    });
    await expect(api.create({ name: "Overflow" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await db.delete(tag).where(eq(tag.id, id));
  });

  it("returns friendly conflicts for case-insensitive concurrent creates", async () => {
    const api = caller(userId);
    const results = await Promise.allSettled([
      api.create({ name: " Lunch box " }),
      api.create({ name: "LUNCH BOX" }),
      api.create({ name: "lunch box" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject(conflict);
    expect(
      await db.select().from(tag).where(eq(tag.userId, userId)),
    ).toHaveLength(1);
  });

  it("serializes competing renames and leaves the losing tag unchanged", async () => {
    const api = caller(userId);
    const first = await api.create({
      name: "First",
      description: "First description",
    });
    const second = await api.create({
      name: "Second",
      description: "Second description",
    });
    const results = await Promise.allSettled([
      api.update({
        id: first.id,
        name: " Packed lunch ",
        description: "Changed",
      }),
      api.update({
        id: second.id,
        name: "PACKED LUNCH",
        description: "Changed",
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject(conflict);
    const loser = results[0]?.status === "rejected" ? first : second;
    expect((await api.list()).find((item) => item.id === loser.id)).toEqual(
      loser,
    );
  });

  it("uses the same name lock for creates and renames", async () => {
    const api = caller(userId);
    const original = await api.create({ name: "Original" });
    const results = await Promise.allSettled([
      api.create({ name: "Same name" }),
      api.update({ id: original.id, name: "SAME NAME" }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject(conflict);
  });

  it("rejects create and rename collisions with every global default name", async () => {
    const api = caller(userId);
    const defaults = (await api.list()).filter((item) => item.userId === null);
    const custom = await api.create({
      name: "Custom",
      description: "Keep this",
    });
    for (const builtIn of defaults) {
      const name = ` ${builtIn.name.toUpperCase()} `;
      await expect(api.create({ name })).rejects.toMatchObject(conflict);
      await expect(api.update({ id: custom.id, name })).rejects.toMatchObject(
        conflict,
      );
    }
    expect((await api.list()).find((item) => item.id === custom.id)).toEqual(
      custom,
    );
  });

  it("keeps tags account-owned while allowing matching names in different accounts", async () => {
    const owner = caller(userId);
    const other = caller(await createUser());
    const custom = await owner.create({
      name: "Private",
      description: "Owner only",
    });
    await expect(other.create({ name: "PRIVATE" })).resolves.toBeDefined();
    expect((await other.list()).some((item) => item.id === custom.id)).toBe(
      false,
    );
    for (const name of ["Changed", "PRIVATE", "Vegetarian"])
      await expect(other.update({ id: custom.id, name })).rejects.toMatchObject(
        missing,
      );
    await expect(other.delete({ id: custom.id })).rejects.toMatchObject(
      missing,
    );
    expect((await owner.list()).find((item) => item.id === custom.id)).toEqual(
      custom,
    );
  });

  it("keeps built-in tags immutable even when the requested name conflicts", async () => {
    const api = caller(userId);
    const builtIn = (await api.list()).find((item) => item.userId === null);
    if (!builtIn) throw new Error("Missing default tag");
    const custom = await api.create({ name: "Custom" });
    for (const name of ["Changed", custom.name])
      await expect(api.update({ id: builtIn.id, name })).rejects.toMatchObject(
        missing,
      );
    await expect(api.delete({ id: builtIn.id })).rejects.toMatchObject(missing);
    expect((await api.list()).find((item) => item.id === builtIn.id)).toEqual(
      builtIn,
    );
  });

  it("normalizes creates and updates consistently and permits case-only self renames", async () => {
    const api = caller(userId);
    const custom = await api.create({
      name: " Lunch ",
      description: " Details ",
    });
    expect(custom).toMatchObject({ name: "Lunch", description: "Details" });
    await expect(
      api.update({
        id: custom.id,
        name: " LUNCH ",
        description: " New details ",
      }),
    ).resolves.toMatchObject({
      id: custom.id,
      name: "LUNCH",
      description: "New details",
    });
    for (const name of [" ", "x".repeat(41)]) {
      await expect(api.create({ name })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(api.update({ id: custom.id, name })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
  });
});
