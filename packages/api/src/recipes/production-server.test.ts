import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { auth } from "@prep-sheet/auth";
import { db } from "@prep-sheet/db";
import { session, user } from "@prep-sheet/db/schema/auth";
import { recipe } from "@prep-sheet/db/schema/recipe";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sampleRecipe } from "./fixtures";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const ownerId = randomUUID();
const outsiderId = randomUUID();
const userIds = [ownerId, outsiderId];
const ownId = randomUUID();
const longId = randomUUID();
const otherId = randomUUID();
const recipeIds = [ownId, longId, otherId];
const token = randomUUID();
let cookie: string;

beforeAll(async () => {
  const context = await auth.$context;
  const signature = createHmac("sha256", context.secret)
    .update(token)
    .digest("base64");
  cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`;
  await db.insert(user).values(
    userIds.map((id) => ({
      id,
      name: "Production PDF test",
      email: `${id}@example.test`,
    })),
  );
  await db.insert(session).values({
    id: randomUUID(),
    token,
    userId: ownerId,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await db.insert(recipe).values(
    recipeIds.map((id): typeof recipe.$inferInsert => ({
      id,
      userId: id === otherId ? outsiderId : ownerId,
      title: sampleRecipe.title,
      content:
        id === longId
          ? {
              ...sampleRecipe,
              title: "A long recipe with ½ cup crème fraîche at 180°C",
              steps: Array.from(
                { length: 24 },
                (_, index) =>
                  `Step ${index + 1}. ${sampleRecipe.steps[index % 3]}`,
              ),
            }
          : sampleRecipe,
      origin: "manual",
    })),
  );
});

afterAll(async () => {
  await db.delete(recipe).where(inArray(recipe.id, recipeIds));
  await db.delete(user).where(inArray(user.id, userIds));
  await db.$client.end();
});

it("serves authenticated PDFs from a fresh production build without crashing or exposing another account", () => {
  // The isolated wrapper supplies the database and signing secret. Disable external services.
  const runtimeEnv = {
    ...process.env,
    NODE_ENV: "production",
    OPENAI_API_KEY: "",
    POLAR_ACCESS_TOKEN: "",
    POLAR_PRO_PRODUCT_ID: "",
    POLAR_WEBHOOK_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    DISCORD_CLIENT_ID: "",
    DISCORD_CLIENT_SECRET: "",
  };
  execFileSync(
    process.execPath,
    [join(root, "apps/web/node_modules/vite/bin/vite.js"), "build"],
    {
      cwd: join(root, "apps/web"),
      env: runtimeEnv,
      timeout: 90_000,
      maxBuffer: 10_000_000,
    },
  );
  const result = execFileSync(
    process.execPath,
    [join(root, "scripts/production-server-smoke.mjs")],
    {
      cwd: root,
      env: runtimeEnv,
      input: JSON.stringify({ cookie, ownId, longId, otherId }),
      timeout: 45_000,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    },
  );
  expect(result).toContain("Production server and PDF smoke checks passed.");
}, 150_000);
