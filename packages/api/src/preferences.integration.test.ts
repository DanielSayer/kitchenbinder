import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import type { Context } from "./context";
import { preferencesRouter } from "./routers/preferences";

const userIds: string[] = [];

async function caller() {
  const id = randomUUID();
  userIds.push(id);
  await db
    .insert(user)
    .values({ id, name: "Preference test", email: `${id}@example.test` });
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Preference test",
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
  return preferencesRouter.createCaller({ auth: null, session });
}

afterAll(async () => {
  if (userIds.length) await db.delete(user).where(inArray(user.id, userIds));
});

describe("preferences", () => {
  it("defaults the week to Monday", async () => {
    const api = await caller();
    await expect(api.get()).resolves.toEqual({ weekStartsOn: 1 });
  });

  it("saves the week start per user", async () => {
    const api = await caller();
    const other = await caller();
    await api.update({ weekStartsOn: 0 });
    await api.update({ weekStartsOn: 6 });
    await expect(api.get()).resolves.toEqual({ weekStartsOn: 6 });
    await expect(other.get()).resolves.toEqual({ weekStartsOn: 1 });
  });

  it("rejects days outside the week", async () => {
    const api = await caller();
    await expect(api.update({ weekStartsOn: 7 })).rejects.toThrow();
  });
});
