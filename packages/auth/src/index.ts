import { createDb } from "@prep-sheet/db";
import { ensurePersonalHousehold } from "@prep-sheet/db/households";
import * as schema from "@prep-sheet/db/schema/auth";
import { env } from "@prep-sheet/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, freshSessionMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { createAuthRateLimitStorage } from "./rate-limit";

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["x-prep-sheet-client-ip"],
        ipv6Subnet: 64,
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV === "production",
      customStorage: createAuthRateLimitStorage({
        db,
        secret: env.BETTER_AUTH_SECRET,
      }),
    },
    session: { freshAge: 10 * 60 },
    databaseHooks: {
      user: {
        create: {
          // Every user owns a personal "Just me" household. The API also
          // ensures it lazily, so a failure here never blocks sign-up.
          after: async (created) => {
            await ensurePersonalHousehold(db, created.id).catch(() => {
              console.error(
                JSON.stringify({ event: "personal_household_create_failed" }),
              );
            });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/link-social") await freshSessionMiddleware(ctx);
      }),
    },
    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
      },
    },
    socialProviders: {
      ...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
        ? {
            discord: {
              clientId: env.DISCORD_CLIENT_ID,
              clientSecret: env.DISCORD_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    onAPIError: {
      errorURL: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/login`,
    },
    plugins: [tanstackStartCookies()],
  });
}

export const auth = createAuth();
