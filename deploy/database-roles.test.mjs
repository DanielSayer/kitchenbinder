import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { it } from "vitest";

const require = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
);
const { Client } = require("pg");

it("accepts the runbook's restricted roles, migrations and actual query/lock budgets on disposable PostgreSQL 18", async () => {
  assert.equal(process.env.PREP_SHEET_TEST_DATABASE, "isolated");
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/prep_sheet_test");
  assert.ok(url.port && url.port !== "5432");
  const suffix = randomUUID().replaceAll("-", "");
  const database = `deploy_${suffix}`;
  const roles = ["migrate", "runtime", "backup"].map(
    (role) => `deploy_${role}_${suffix}`,
  );
  const password = randomUUID();
  const admin = new Client({ connectionString: url.href });
  await admin.connect();
  const clients = [];
  let owner;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    url.pathname = `/${database}`;
    owner = new Client({ connectionString: url.href });
    await owner.connect();
    const document = await readFile(
      new URL("../docs/lightsail-neon.md", import.meta.url),
      "utf8",
    );
    const blocks = [...document.matchAll(/```sql\r?\n([\s\S]*?)```/g)].map(
      (match) => match[1],
    );
    assert.equal(
      blocks.length,
      2,
      "runbook provisioning and post-migration grants must remain explicit",
    );
    const render = (sql) =>
      roles.reduce(
        (text, role, index) =>
          text.replaceAll(
            `prep_sheet_${["migrate", "runtime", "backup"][index]}`,
            role,
          ),
        sql.replaceAll("PREP_DATABASE", database),
      );
    await owner.query(render(blocks[0]));
    for (const role of roles)
      await owner.query(`ALTER ROLE "${role}" PASSWORD '${password}'`);
    const roleUrl = (role) => {
      const target = new URL(url);
      target.username = role;
      target.password = password;
      return target.href;
    };
    const runner = fileURLToPath(
      new URL("../packages/db/scripts/migrate.mjs", import.meta.url),
    );
    for (const args of [[], ["--verify"]]) {
      const result = spawnSync(process.execPath, [runner, ...args], {
        env: { ...process.env, DATABASE_URL: roleUrl(roles[0]) },
        encoding: "utf8",
        timeout: 30_000,
      });
      assert.equal(
        result.status,
        0,
        "restricted migration owner must migrate and replay verification",
      );
    }
    const migrationOwner = new Client({ connectionString: roleUrl(roles[0]) });
    clients.push(migrationOwner);
    await migrationOwner.connect();
    await migrationOwner.query(render(blocks[1]));
    const runtime = new Client({ connectionString: roleUrl(roles[1]) });
    const backup = new Client({ connectionString: roleUrl(roles[2]) });
    clients.push(runtime, backup);
    await runtime.connect();
    await backup.connect();
    for (const [setting, expected] of [
      ["statement_timeout", "15s"],
      ["lock_timeout", "3s"],
      ["idle_in_transaction_session_timeout", "15s"],
      ["transaction_timeout", "1min"],
    ])
      assert.equal(
        (await runtime.query(`SHOW ${setting}`)).rows[0][setting],
        expected,
      );
    assert.ok(
      (await runtime.query("SELECT * FROM public.prep_sheet_migration"))
        .rowCount > 0,
    );
    await runtime.query(
      "INSERT INTO public.auth_rate_limit VALUES ('isolated-admission', 1, now())",
    );
    await runtime.query(
      "UPDATE public.auth_rate_limit SET count=2 WHERE key='isolated-admission'",
    );
    assert.equal(
      (
        await backup.query(
          "SELECT count FROM public.auth_rate_limit WHERE key='isolated-admission'",
        )
      ).rows[0].count,
      2,
    );
    for (const sql of [
      "CREATE TABLE public.forbidden(id int)",
      "CREATE SCHEMA forbidden",
      "CREATE TEMP TABLE forbidden(id int)",
      "DELETE FROM public.prep_sheet_migration",
      "DROP TABLE public.auth_rate_limit",
    ])
      await assert.rejects(
        runtime.query(sql),
        (error) => error.code === "42501",
      );
    await assert.rejects(
      backup.query("DELETE FROM public.auth_rate_limit"),
      (error) => error.code === "42501",
    );
    await owner.query("BEGIN");
    await owner.query("LOCK public.auth_rate_limit IN ACCESS EXCLUSIVE MODE");
    const lockStart = Date.now();
    await assert.rejects(
      runtime.query("SELECT * FROM public.auth_rate_limit"),
      (error) => error.code === "55P03",
    );
    assert.ok(
      Date.now() - lockStart < 6000,
      "lock wait must be bounded by the configured role default",
    );
    await owner.query("ROLLBACK");
    await assert.rejects(
      runtime.query("SELECT pg_sleep(16)"),
      (error) => error.code === "57014",
    );
    assert.equal((await runtime.query("SELECT 1 AS alive")).rows[0].alive, 1);
    await runtime.query(
      "DELETE FROM public.auth_rate_limit WHERE key='isolated-admission'",
    );
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
    await owner?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    for (const role of roles)
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    await admin.end();
  }
});
