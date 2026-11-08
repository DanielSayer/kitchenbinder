import { randomUUID } from "node:crypto";
import { createDb } from "@prep-sheet/db";
import * as schema from "@prep-sheet/db/schema/auth";
import { household } from "@prep-sheet/db/schema/household";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { auth } from "./index";

const db = createDb();
const email = `${randomUUID()}@example.test`;
const testAuth = betterAuth({
  ...auth.options,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  plugins: [],
  // Only the isolated test instance enables passwords.
  emailAndPassword: { enabled: true },
});

afterAll(async () => {
  const created = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (created) {
    await db.delete(household).where(eq(household.ownerId, created.id));
    await db.delete(schema.user).where(eq(schema.user.id, created.id));
  }
  await db.$client.end();
});

it("creates and signs in a real database account without an issuer", async () => {
  const password = "isolated-account-test-password-123456";
  const signup = await testAuth.api.signUpEmail({
    body: { name: "Schema regression", email, password },
    asResponse: true,
  });
  expect(signup.status).toBe(200);
  const created = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (!created) throw new Error("Missing newly registered user");
  const account = await db.query.account.findFirst({
    where: eq(schema.account.userId, created.id),
  });
  expect(account).toMatchObject({
    issuer: null,
    providerId: "credential",
    accountId: created.id,
  });
  const signin = await testAuth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  expect(signin.status).toBe(200);
  expect(signin.headers.getSetCookie().join(";")).toContain("session_token");
});
