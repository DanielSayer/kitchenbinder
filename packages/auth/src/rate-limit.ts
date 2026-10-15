import { createHmac } from "node:crypto";
import type { createDb } from "@prep-sheet/db";
import type { BetterAuthOptions } from "better-auth";
import { sql } from "drizzle-orm";
import { z } from "zod";

type Storage = NonNullable<
  NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]
>;

const decision = z.object({
  allowed: z.boolean(),
  retryAfter: z.number().int().min(0),
});

export function createAuthRateLimitStorage({
  db,
  secret,
}: {
  db: ReturnType<typeof createDb>;
  secret: string;
}): Storage {
  return {
    async consume(key, rule) {
      // Better Auth normalises IPv4/mapped IPv6 and applies its /64 IPv6 rule.
      // Never persist the plaintext IP/path key. Replicas must use the same secret.
      const digest = createHmac("sha256", secret)
        .update("auth-rate-limit\0")
        .update(key)
        .digest("hex");
      try {
        const consumed = await db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
          // Capture one clock value after the conflict row is locked. A queued
          // statement's start time can precede expiry even after the lock clears.
          const result = await tx.execute(sql`
            INSERT INTO auth_rate_limit (key, count, expires_at)
            VALUES (${digest}, 1, clock_timestamp() + ${rule.window} * interval '1 second')
            ON CONFLICT (key) DO UPDATE SET (count, expires_at) = (
              SELECT
                CASE WHEN auth_rate_limit.expires_at <= instant.now THEN 1
                  ELSE least(auth_rate_limit.count + 1, ${rule.max + 1}) END,
                CASE WHEN auth_rate_limit.expires_at <= instant.now
                    OR auth_rate_limit.count < ${rule.max}
                  THEN instant.now + ${rule.window} * interval '1 second'
                  ELSE auth_rate_limit.expires_at END
              FROM (SELECT clock_timestamp() AS now) AS instant
            )
            RETURNING count <= ${rule.max} AS allowed,
              greatest(0, ceil(extract(epoch FROM expires_at - clock_timestamp())))::int AS "retryAfter"
          `);
          const parsed = decision.parse(result.rows[0]);
          return {
            allowed: parsed.allowed,
            retryAfter: parsed.allowed ? null : parsed.retryAfter,
          };
        });
        if (!consumed.allowed) return consumed;
        // Clean up after committing the counter. Holding cleanup locks while
        // consuming another key can deadlock concurrent requests at expiry.
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`SET LOCAL statement_timeout = '2s'`);
            await tx.execute(sql`
              WITH expired AS (
                SELECT key FROM auth_rate_limit
                WHERE expires_at <= statement_timestamp()
                ORDER BY expires_at LIMIT 10 FOR UPDATE SKIP LOCKED
              )
              DELETE FROM auth_rate_limit USING expired
              WHERE auth_rate_limit.key = expired.key
            `);
          });
        } catch {
          console.error(
            JSON.stringify({ event: "auth_rate_limit_cleanup_failed" }),
          );
        }
        return consumed;
      } catch {
        console.error(JSON.stringify({ event: "auth_rate_limit_unavailable" }));
        // Fail closed. Do not expose database errors, URLs, IPs or secrets.
        throw new Error("Authentication rate limit unavailable");
      }
    },
  };
}
