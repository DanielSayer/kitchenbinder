CREATE TABLE IF NOT EXISTS "auth_rate_limit" (
  "key" text PRIMARY KEY NOT NULL,
  "count" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
CREATE INDEX IF NOT EXISTS "auth_rate_limit_expiry_idx" ON "auth_rate_limit" USING btree ("expires_at");
