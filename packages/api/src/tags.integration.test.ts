import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { group, groupMember } from "@prep-sheet/db/schema/group";
import { tag } from "@prep-sheet/db/schema/tag";
import { eq, inArray, isNull, sql } from "drizzle-orm";
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
        message: "You can create up to 100 custom tags per collection.",
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

  it.each(["create", "rename"])(
    "maps a PostgreSQL uniqueness failure during %s to a friendly conflict",
    async (operation) => {
      const api = caller(userId);
      const original = await api.create({ name: "Original" });
      const competing = await api.create({ name: "Competing" });
      const { pending } = await db.transaction(async (tx) => {
        // Hold writes after the API's name check so a writer that does not use
        // the account lock can commit a collision before the API writes.
        await tx.execute(sql`lock table ${tag} in share mode`);
        const pending = Promise.allSettled([
          operation === "create"
            ? api.create({ name: "Taken" })
            : api.update({ id: original.id, name: "Taken" }),
        ]);
        const statement =
          operation === "create" ? 'insert into "tag"' : 'update "tag"';
        await expect
          .poll(
            async () => {
              const result = await db.execute<{ waiting: boolean }>(sql`
                select exists (
                  select 1 from pg_stat_activity
                  where datname = current_database()
                    and pid <> pg_backend_pid()
                    and wait_event_type = 'Lock'
                    and query like ${`${statement}%`}
                ) as waiting
              `);
              return result.rows[0]?.waiting;
            },
            { timeout: 5000 },
          )
          .toBe(true);
        await tx
          .update(tag)
          .set({ name: "TAKEN" })
          .where(eq(tag.id, competing.id));
        return { pending };
      });
      expect(await pending).toMatchObject([
        { status: "rejected", reason: conflict },
      ]);
      const remaining = (await api.list()).filter(
        (item) => item.userId === userId,
      );
      expect(remaining).toHaveLength(2);
      expect(remaining.find((item) => item.id === original.id)).toEqual(
        original,
      );
      expect(remaining.find((item) => item.id === competing.id)?.name).toBe(
        "TAKEN",
      );
    },
  );

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

  it("serializes shared-collection names and limits across different members", async () => {
    const secondId = await createUser();
    const groupId = randomUUID();
    await db
      .insert(group)
      .values({ id: groupId, ownerId: userId, name: "Tag admission" });
    try {
      await db.insert(groupMember).values([
        { groupId, userId },
        { groupId, userId: secondId },
      ]);
      await db.insert(tag).values(
        Array.from({ length: 99 }, (_, index) => ({
          id: randomUUID(),
          groupId,
          name: `Shared ${index}`,
        })),
      );
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          caller(index % 2 ? userId : secondId).create({
            groupId,
            name: `Final ${index}`,
          }),
        ),
      );
      expect(
        results.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({ code: "BAD_REQUEST" });
      const existing = (await caller(secondId).list({ groupId })).find(
        (item) => item.groupId === groupId,
      );
      if (!existing) throw new Error("Missing shared tag");
      await caller(secondId).delete({ id: existing.id, groupId });
      const collisions = await Promise.allSettled([
        caller(userId).create({ groupId, name: "Same shared name" }),
        caller(secondId).create({ groupId, name: "SAME SHARED NAME" }),
      ]);
      expect(
        collisions.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        collisions.find((item) => item.status === "rejected"),
      ).toMatchObject({ reason: conflict });
      // Shared definitions are independent of the member who created them.
      await db.delete(user).where(eq(user.id, secondId));
      expect(
        (await caller(userId).list({ groupId })).filter(
          (item) => item.groupId === groupId,
        ),
      ).toHaveLength(100);
    } finally {
      await db.delete(group).where(eq(group.id, groupId));
    }
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
