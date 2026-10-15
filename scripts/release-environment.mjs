import { checkRelease, connect } from "../packages/db/scripts/migrate.mjs";
import { getSupportConfig } from "../packages/env/src/support.ts";

export async function verifyRelease() {
  getSupportConfig(process.env);
  if (process.env.NODE_ENV !== "production")
    throw new Error("NODE_ENV must be production");
  if (process.env.SKIP_ENV_VALIDATION)
    throw new Error("Release cannot skip environment validation");
  if (
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32
  ) {
    throw new Error("BETTER_AUTH_SECRET requires at least 32 characters");
  }
  const origin = new URL(process.env.BETTER_AUTH_URL);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.pathname !== "/"
  ) {
    throw new Error("BETTER_AUTH_URL must be the public HTTP origin");
  }
  const client = connect(process.env.DATABASE_URL);
  try {
    await client.connect();
    await checkRelease(client);
  } finally {
    await client.end();
  }
  return origin.origin;
}
