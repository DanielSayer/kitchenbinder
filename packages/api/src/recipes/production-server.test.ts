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
const maximumId = randomUUID();
const otherId = randomUUID();
const recipeIds = [ownId, longId, maximumId, otherId];
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
        id === maximumId
          ? {
              ...sampleRecipe,
              ingredients: Array.from({ length: 100 }, () =>
                "ingredient ".repeat(200).slice(0, 2000),
              ),
              steps: Array.from({ length: 100 }, () =>
                "method ".repeat(300).slice(0, 2000),
              ),
            }
          : id === longId
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
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NODE_ENV: "production",
    SUPPORT_EMAIL: "support@example.test",
    SUPPORT_OPERATOR: "Isolated support test operator",
    PREP_SHEET_TEST_DATABASE: "isolated",
    AI_ENABLED: "false",
    BILLING_MODE: "disabled",
    OPENAI_API_KEY: "",
    POLAR_ACCESS_TOKEN: "",
    POLAR_PRO_PRODUCT_ID: "",
    POLAR_WEBHOOK_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    DISCORD_CLIENT_ID: "",
    DISCORD_CLIENT_SECRET: "",
  };
  const image = process.env.PREP_SHEET_RELEASE_IMAGE;
  if (!image)
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
  const containerUrl = new URL(runtimeEnv.DATABASE_URL ?? "");
  const network =
    process.platform === "linux"
      ? "--network=host"
      : "--add-host=host.docker.internal:host-gateway";
  if (process.platform !== "linux")
    containerUrl.hostname = "host.docker.internal";
  const result = execFileSync(
    image ? "docker" : process.execPath,
    image
      ? [
          "run",
          "--rm",
          "-i",
          network,
          "-e",
          "NODE_ENV=production",
          "-e",
          `SUPPORT_EMAIL=${runtimeEnv.SUPPORT_EMAIL}`,
          "-e",
          `SUPPORT_OPERATOR=${runtimeEnv.SUPPORT_OPERATOR}`,
          "-e",
          "PREP_SHEET_TEST_DATABASE=isolated",
          "-e",
          "AI_ENABLED=false",
          "-e",
          "BILLING_MODE=disabled",
          "-e",
          `DATABASE_URL=${containerUrl.href}`,
          "-e",
          `BETTER_AUTH_SECRET=${runtimeEnv.BETTER_AUTH_SECRET}`,
          "-e",
          `BETTER_AUTH_URL=${runtimeEnv.BETTER_AUTH_URL}`,
          image,
          "node",
          "scripts/production-server-smoke.mjs",
        ]
      : [join(root, "scripts/production-server-smoke.mjs")],
    {
      cwd: root,
      env: runtimeEnv,
      input: JSON.stringify({ cookie, ownId, longId, maximumId, otherId }),
      timeout: 45_000,
      maxBuffer: 1_000_000,
      encoding: "utf8",
    },
  );
  expect(result).toContain("Production server and PDF smoke checks passed.");
}, 150_000);
