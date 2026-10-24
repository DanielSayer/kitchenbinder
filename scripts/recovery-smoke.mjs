import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { connect } from "../packages/db/scripts/migrate.mjs";
import { backupDatabase } from "./backup-database.mjs";
import { rehearseRecovery } from "./rehearse-recovery.mjs";

assert.equal(process.env.PREP_SHEET_TEST_DATABASE, "isolated");
const source = new URL(process.env.DATABASE_URL);
assert.equal(source.hostname, "127.0.0.1");
assert.equal(source.pathname, "/prep_sheet_test");
assert.ok(source.port && source.port !== "5432");
const directory = await mkdtemp(join(tmpdir(), "prep-sheet-recovery-"));
const archive = join(directory, "rehearsal.dump");
const client = connect(source.href);
const userId = randomUUID();
const recipeId = randomUUID();
const importId = randomUUID();
const token = randomUUID();
const householdId = randomUUID();
await client.connect();
try {
  await client.query('INSERT INTO "user"(id,name,email) VALUES ($1,$1,$2)', [
    userId,
    `${userId}@example.test`,
  ]);
  await client.query(
    "INSERT INTO session(id,user_id,token,expires_at,updated_at) VALUES ($1,$2,$3,now()+interval '1 hour',now())",
    [randomUUID(), userId, token],
  );
  await client.query(
    "INSERT INTO recipe(id,user_id,title,content,origin) VALUES ($1,$2,'Recovery acceptance','{\"preserve\":\"recipe\"}','manual')",
    [recipeId, userId],
  );
  await client.query(
    "INSERT INTO recipe_import(id,user_id,fingerprint,input,state,generated,save_attempts) VALUES ($1::uuid,$2,$1::text,'private checkpoint','ready','{\"preserve\":\"checkpoint\"}',2)",
    [importId, userId],
  );
  await client.query(
    "INSERT INTO billing_account(user_id,status,trial_used) VALUES ($1,'pro',true)",
    [userId],
  );
  await client.query(
    "INSERT INTO ai_spend(import_id,reserved_cents) VALUES ($1,25)",
    [importId],
  );
  await client.query(
    "INSERT INTO household(id,name,owner_id,personal) VALUES ($1,'Just me',$2,true)",
    [householdId, userId],
  );
  await client.query(
    "INSERT INTO household_member(household_id,user_id) VALUES ($1,$2)",
    [householdId, userId],
  );
  await client.query(
    'INSERT INTO meal_planner(household_id,meals,revision) VALUES ($1,\'[{"preserve":"meal"}]\',7)',
    [householdId],
  );
  await client.query(
    "INSERT INTO shopping_item(id,household_id,added_by,text) VALUES ($1,$2,$3,'Recovery shopping')",
    [randomUUID(), householdId, userId],
  );
  const tables = [
    "user",
    "session",
    "recipe",
    "recipe_import",
    "billing_account",
    "ai_spend",
    "household",
    "meal_planner",
    "shopping_item",
    "prep_sheet_migration",
  ];
  const contents = async (connection) => {
    const result = {};
    for (const table of tables)
      result[table] = (
        await connection.query(
          `SELECT row_to_json(t) AS row FROM "${table}" t ORDER BY row_to_json(t)::text`,
        )
      ).rows;
    return result;
  };
  const before = await contents(client);
  backupDatabase({ source: source.href, archive });
  assert.throws(
    () =>
      backupDatabase({
        source: "postgresql://bad:bad@127.0.0.1:1/missing",
        archive,
      }),
    /Backup failed/,
  );
  const result = await rehearseRecovery({
    archive,
    accept: async ({ client: restored, url }) => {
      assert.deepEqual(
        await contents(restored),
        before,
        "Restoration must preserve all selected rows and migration hashes",
      );
      const heartbeat = join(directory, "worker.json");
      await writeFile(
        heartbeat,
        JSON.stringify({
          version: 1,
          timestamp: Date.now(),
          instance: randomUUID(),
        }),
      );
      const child = fork(new URL("./start-web.mjs", import.meta.url), [], {
        env: {
          ...process.env,
          NODE_ENV: "production",
          PORT: "0",
          HOST: "127.0.0.1",
          DATABASE_URL: url,
          PREP_SHEET_TEST_DATABASE: undefined,
          BETTER_AUTH_URL: "https://recovery-smoke.example.test",
          AI_ENABLED: "false",
          BILLING_MODE: "disabled",
          SUPPORT_EMAIL: "support@example.test",
          SUPPORT_OPERATOR: "Isolated recovery test operator",
          WORKER_HEARTBEAT_PATH: heartbeat,
          OPENAI_API_KEY: "",
          POLAR_ACCESS_TOKEN: "",
          POLAR_PRO_PRODUCT_ID: "",
          POLAR_WEBHOOK_SECRET: "",
          GOOGLE_CLIENT_ID: "recovery-smoke-no-provider-calls",
          GOOGLE_CLIENT_SECRET: "recovery-smoke-no-provider-calls",
          DISCORD_CLIENT_ID: "",
          DISCORD_CLIENT_SECRET: "",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const closed = once(child, "exit");
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      try {
        let port;
        for (let attempt = 0; attempt < 200; attempt++) {
          port = output.match(/"event":"web_started","port":(\d+)/)?.[1];
          if (port) break;
          assert.equal(child.exitCode, null, "restored application exited");
          await setTimeout(50);
        }
        assert.ok(port, "Restored application must start");
        const origin = `http://127.0.0.1:${port}`;
        const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET)
          .update(token)
          .digest("base64");
        const response = await fetch(
          `${origin}/api/trpc/recipes.get?input=${encodeURIComponent(JSON.stringify({ id: recipeId }))}`,
          {
            headers: {
              cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
            },
          },
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).result.data.id, recipeId);
        // The restored aged checkpoint intentionally makes readiness unavailable.
        assert.equal((await fetch(`${origin}/health/live`)).status, 200);
        child.send("shutdown");
        assert.equal((await closed)[0], 0);
      } finally {
        if (child.exitCode === null) child.kill();
      }
    },
  });
  // A bad archive must fail without modifying the source and remove its container.
  const corrupt = join(directory, "corrupt.dump");
  await writeFile(corrupt, "not a postgres archive");
  await assert.rejects(() => rehearseRecovery({ archive: corrupt }));
  assert.deepEqual(await contents(client), before);
  process.stdout.write(
    `${JSON.stringify({ ...result, checks: ["row_equality", "migration_hashes_pg18_icu", "authenticated_restored_recipe_http", "failed_backup_preserves_archive", "corrupt_archive_cleanup", "source_unchanged"] })}\n`,
  );
} finally {
  await client.query("DELETE FROM ai_spend WHERE import_id=$1", [importId]);
  await client.query("DELETE FROM household WHERE owner_id=$1", [userId]);
  await client.query('DELETE FROM "user" WHERE id=$1', [userId]);
  await client.end();
  await rm(directory, { recursive: true, force: true });
}
