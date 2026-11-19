import { randomUUID } from "node:crypto";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { household } from "@prep-sheet/db/schema/household";
import { shoppingItem } from "@prep-sheet/db/schema/shopping";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Context } from "../context";
import { appRouter } from "../routers";

const ownerId = randomUUID();
const otherId = randomUUID();
function caller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Add lines test",
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
  return appRouter.createCaller({ auth: null, session }).shopping;
}
const owner = caller(ownerId);
const other = caller(otherId);
const line = (text: string) => ({ id: randomUUID(), text });
const texts = async () => (await owner.list()).map((item) => item.text);

describe("shopping.addLines with PostgreSQL", () => {
  beforeAll(async () => {
    await db.insert(user).values(
      [ownerId, otherId].map((id) => ({
        id,
        name: "Add lines test",
        email: `${id}@example.test`,
      })),
    );
  });
  beforeEach(async () => {
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId]));
  });
  afterAll(async () => {
    await db
      .delete(household)
      .where(inArray(household.ownerId, [ownerId, otherId]));
    await db.delete(user).where(inArray(user.id, [ownerId, otherId]));
    await db.$client.end();
  });

  it("adds parsed lines in input order", async () => {
    const lines = ["Zucchini", "6 eggs", "500 g plain flour", "Apples"].map(
      line,
    );
    await owner.addLines({ lines });
    expect(await owner.list()).toMatchObject(
      lines.map(({ id, text }) => ({ id, text })),
    );
    expect((await owner.list())[2]).toMatchObject({
      ingredient: { unit: "g", quantity: 500 },
    });
  });

  it("replays identical lines and adds only new ones", async () => {
    const milk = line("Milk");
    const lines = [milk, line("Bread")];
    await owner.addLines({ lines });
    await owner.addLines({ lines: [...lines, line("Butter")] });
    await owner.addItem(milk);
    expect(await texts()).toEqual(["Milk", "Bread", "Butter"]);
  });

  it("rejects changed text for a used ID without adding anything", async () => {
    const milk = line("Milk");
    await owner.addLines({ lines: [milk] });
    await expect(
      owner.addLines({ lines: [line("Bread"), { ...milk, text: "Oat milk" }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The web retries a failed add with its draft ID after edits.
    await expect(
      owner.addItem({ ...milk, text: "Oat milk" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await texts()).toEqual(["Milk"]);
  });

  it("rejects an ID used by another household", async () => {
    const milk = line("Milk");
    await owner.addLines({ lines: [milk] });
    await expect(other.addLines({ lines: [milk] })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This item ID has already been used.",
    });
    expect(await other.list()).toEqual([]);
  });

  it("checks capacity for the whole batch", async () => {
    await owner.addLines({ lines: [line("Milk")] });
    const [list] = await db
      .select({ householdId: shoppingItem.householdId })
      .from(shoppingItem)
      .where(inArray(shoppingItem.addedBy, [ownerId]));
    if (!list) throw new Error("Missing list");
    await db.insert(shoppingItem).values(
      Array.from({ length: 998 }, (_, index) => ({
        id: randomUUID(),
        householdId: list.householdId,
        addedBy: ownerId,
        text: `Item ${index}`,
      })),
    );
    await expect(
      owner.addLines({ lines: [line("Eggs"), line("Flour")] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await owner.list()).toHaveLength(999);
    await owner.addLines({ lines: [line("Eggs")] });
    expect(await owner.list()).toHaveLength(1000);
  });

  it("rejects duplicate IDs in one batch", async () => {
    const milk = line("Milk");
    await expect(owner.addLines({ lines: [milk, milk] })).rejects.toMatchObject(
      { code: "BAD_REQUEST" },
    );
  });
});
