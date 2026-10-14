import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { db } from "../index";

afterAll(async () => {
  await db.$client.end();
});

it("adds manual request identity without guessing legacy payloads and can be applied twice", async () => {
  const connection = await db.$client.connect();
  try {
    await connection.query("BEGIN");
    // PostgreSQL resolves this connection-local table before the real recipe table.
    await connection.query(
      "CREATE TEMP TABLE recipe (id uuid PRIMARY KEY, content jsonb NOT NULL) ON COMMIT DROP",
    );
    const id = crypto.randomUUID();
    const content = { title: "A recipe edited since its original save" };
    await connection.query("INSERT INTO recipe VALUES ($1, $2)", [id, content]);
    const upgrade = readFileSync(
      new URL("./edit-loss-manual-request.sql", import.meta.url),
      "utf8",
    );
    await connection.query(upgrade);
    await connection.query(upgrade);
    expect((await connection.query("SELECT * FROM recipe")).rows).toEqual([
      { id, content, manual_request_hash: null },
    ]);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
  }
});
