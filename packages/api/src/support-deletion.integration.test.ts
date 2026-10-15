import { randomUUID } from "node:crypto";
import { Polar } from "@polar-sh/sdk";
import type { CustomerState } from "@polar-sh/sdk/models/components/customerstate";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { accountDeletionRequest } from "@prep-sheet/db/schema/support";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { completeAccountDeletion } from "./account-deletion";
import * as billing from "./billing/polar";
import type { Context } from "./context";
import { sampleRecipe } from "./recipes/fixtures";
import { appRouter } from "./routers";

vi.hoisted(() => {
  vi.stubEnv("BILLING_MODE", "sandbox");
  vi.stubEnv("POLAR_SERVER", "sandbox");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "isolated-test-token");
  vi.stubEnv("POLAR_PRO_PRODUCT_ID", "11111111-1111-4111-8111-111111111111");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", "isolated-test-secret");
});

const ids: string[] = [];
const polar = new Polar({ accessToken: "isolated-test-token" });
const customers = Object.getPrototypeOf(polar.customers);
const subscriptions = Object.getPrototypeOf(polar.subscriptions);
const state: CustomerState = {
  id: randomUUID(),
  createdAt: new Date(),
  modifiedAt: null,
  metadata: {},
  externalId: null,
  email: "fixture@example.test",
  emailVerified: true,
  type: "individual",
  name: "Deletion fixture",
  billingName: null,
  billingAddress: null,
  taxId: null,
  organizationId: randomUUID(),
  deletedAt: null,
  avatarUrl: null,
  activeSubscriptions: [],
  grantedBenefits: [],
  activeMeters: [],
};

beforeEach(() => {
  // Every SDK entry point used by deletion fails locally unless the test supplies a response.
  vi.spyOn(customers, "getStateExternal").mockRejectedValue(
    new Error("Simulated provider outage"),
  );
  vi.spyOn(subscriptions, "list").mockRejectedValue(
    new Error("Simulated provider outage"),
  );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.delete(recipe).where(inArray(recipe.userId, ids));
  await db.delete(user).where(inArray(user.id, ids));
  await db.$client.end();
});

async function fixture(
  snapshot?: Omit<typeof billingAccount.$inferInsert, "userId">,
) {
  const id = randomUUID();
  const reference = randomUUID();
  ids.push(id);
  await db
    .insert(user)
    .values({ id, name: "Deletion rehearsal", email: `${id}@example.test` });
  await db.insert(recipe).values({
    id: randomUUID(),
    userId: id,
    title: "Private",
    origin: "manual",
    content: sampleRecipe,
  });
  await db.insert(accountDeletionRequest).values({ userId: id, id: reference });
  if (snapshot)
    await db.insert(billingAccount).values({ userId: id, ...snapshot });
  return { id, reference };
}

async function retained(id: string) {
  expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(1);
  expect(
    await db.select().from(recipe).where(eq(recipe.userId, id)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(accountDeletionRequest)
      .where(eq(accountDeletionRequest.userId, id)),
  ).toHaveLength(1);
}

it("retains the account and pending request when billing configuration is unavailable", async () => {
  const { id, reference } = await fixture({ customerId: randomUUID() });
  vi.spyOn(billing, "billingEnabled").mockReturnValue(false);
  await expect(completeAccountDeletion(reference)).rejects.toThrow(
    "Restore Polar configuration",
  );
  await retained(id);
});

it.each(["state", "subscriptions"])(
  "rolls back deletion on a provider %s outage",
  async (failure) => {
    const { id, reference } = await fixture({
      customerId: randomUUID(),
      status: "active",
    });
    if (failure === "subscriptions")
      vi.spyOn(customers, "getStateExternal").mockResolvedValue(state);
    await expect(completeAccountDeletion(reference)).rejects.toThrow(
      "Simulated provider outage",
    );
    await retained(id);
    const [account] = await db
      .select()
      .from(billingAccount)
      .where(eq(billingAccount.userId, id));
    expect(account?.status).toBe("active");
  },
);

it.each(["active", "past_due", "unpaid", "paused", "incomplete"])(
  "blocks unresolved %s subscriptions even without a local customer ID",
  async (status) => {
    const { id, reference } = await fixture({ trialUsed: true });
    vi.spyOn(customers, "getStateExternal").mockResolvedValue(state);
    vi.spyOn(subscriptions, "list").mockResolvedValue(
      (async function* () {
        yield { result: { items: [{ status }] } };
      })(),
    );
    await expect(completeAccountDeletion(reference)).rejects.toThrow(
      "Cancel the Polar subscription",
    );
    await retained(id);
  },
);

it.each(["future", "unknown"])(
  "blocks a checkout with %s expiry and rechecks billing after expiry is resolved",
  async (expiry) => {
    const { id, reference } = await fixture({
      trialUsed: true,
      checkoutUrl: "https://checkout.example.test/fixture",
      checkoutExpiresAt:
        expiry === "future" ? new Date(Date.now() + 60_000) : null,
    });
    await expect(completeAccountDeletion(reference)).rejects.toThrow(
      "pending Polar checkout",
    );
    await retained(id);
    await db
      .update(billingAccount)
      .set({ checkoutExpiresAt: new Date(0) })
      .where(eq(billingAccount.userId, id));
    vi.spyOn(customers, "getStateExternal").mockResolvedValue(state);
    vi.spyOn(subscriptions, "list").mockResolvedValue(
      (async function* () {
        yield {
          result: {
            items: [{ status: "canceled" }, { status: "incomplete_expired" }],
          },
        };
      })(),
    );
    await completeAccountDeletion(reference);
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0);
    expect(
      await db.select().from(recipe).where(eq(recipe.userId, id)),
    ).toHaveLength(0);
  },
);

async function waitForBlockedQuery(fragment: string) {
  await expect
    .poll(async () => {
      const result = await db.$client.query<{ count: string }>(
        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE $1",
        [`%${fragment}%`],
      );
      return Number(result.rows[0]?.count);
    })
    .toBeGreaterThan(0);
}

function supportCaller(id: string) {
  const now = new Date();
  const session: Context["session"] = {
    user: {
      id,
      name: "Race fixture",
      email: `${id}@example.test`,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: randomUUID(),
      token: randomUUID(),
      userId: id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
    },
  };
  return appRouter.createCaller({ auth: null, session }).support;
}

it("honours cancellation that locks the request before operator completion", async () => {
  const { id, reference } = await fixture();
  const blocker = await db.$client.connect();
  let completion: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("DELETE FROM account_deletion_request WHERE id = $1", [
      reference,
    ]);
    completion = completeAccountDeletion(reference).then(
      () => "deleted",
      (error: unknown) => error,
    );
    await waitForBlockedQuery("account_deletion_request");
    await blocker.query("COMMIT");
    expect(await completion).toBeInstanceOf(Error);
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(1);
    expect(
      await db.select().from(recipe).where(eq(recipe.userId, id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(accountDeletionRequest)
        .where(eq(accountDeletionRequest.userId, id)),
    ).toHaveLength(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await completion;
  }
});

it("serialises cancellation behind completion that already locked the request", async () => {
  const { id, reference } = await fixture();
  const blocker = await db.$client.connect();
  let completion: Promise<unknown> | undefined;
  let cancellation: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [id]);
    completion = completeAccountDeletion(reference);
    await waitForBlockedQuery('from "user"');
    cancellation = supportCaller(id).cancelDeletion();
    await waitForBlockedQuery('delete from "account_deletion_request"');
    await blocker.query("COMMIT");
    await Promise.all([completion, cancellation]);
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(accountDeletionRequest)
        .where(eq(accountDeletionRequest.userId, id)),
    ).toHaveLength(0);
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([completion, cancellation]);
  }
});
