import { env } from "@prep-sheet/env/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export function createDb() {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  });
  pool.on("error", () => {
    // pg already removes the failed idle client. Error/client objects can contain
    // credentials and query data; foreground failures still reject their caller.
    console.error(JSON.stringify({ event: "database_pool_idle_error" }));
  });
  return drizzle(pool, { schema });
}

export const db = createDb();
