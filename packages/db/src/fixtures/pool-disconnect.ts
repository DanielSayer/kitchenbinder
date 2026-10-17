import { z } from "zod";
import { createDb } from "../index";

const database = createDb();
const pool = database.$client;

try {
  const client = await pool.connect();
  const original = z
    .object({ pid: z.number().int().positive() })
    .parse((await client.query("SELECT pg_backend_pid() AS pid")).rows[0]);
  // Observe removal without adding an error listener: only the factory's
  // production handler must protect this process from an unhandled pool error.
  const removed = new Promise<{
    removed: boolean;
    total: number;
    idle: number;
  }>((resolve) => {
    pool.once("remove", (removedClient) => {
      resolve({
        removed: removedClient === client,
        total: pool.totalCount,
        idle: pool.idleCount,
      });
    });
  });
  client.release();
  process.send?.({ kind: "ready", pid: original.pid, idle: pool.idleCount });

  const disposal = await removed;
  const replacement = await pool.connect();
  try {
    const result = z
      .object({ pid: z.number().int().positive(), answer: z.literal(42) })
      .parse(
        (
          await replacement.query(
            "SELECT pg_backend_pid() AS pid, 42 AS answer",
          )
        ).rows[0],
      );
    process.send?.({
      kind: "recovered",
      disposal,
      differentClient: replacement !== client,
      ...result,
    });
  } finally {
    replacement.release();
  }
} finally {
  await pool.end();
  process.disconnect?.();
}
