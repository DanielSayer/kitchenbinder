import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, expect, it } from "vitest";

const runner = fileURLToPath(
  new URL("../scripts/migrate.mjs", import.meta.url),
);
const baseline = readFileSync(
  new URL("./migrations/0000_production_baseline.sql", import.meta.url),
  "utf8",
);
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
afterAll(() => admin.end());

async function database(
  test: (
    client: pg.Client,
    run: (...args: string[]) => string,
  ) => Promise<void>,
) {
  const name = `migration_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [runner, ...args], {
      env: { ...process.env, DATABASE_URL: url.href },
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    await test(client, run);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
}

async function seed(client: pg.Client) {
  await client.query(`
    INSERT INTO "user" (id,name,email) VALUES ('migration-user','Existing person','migration@example.test');
    INSERT INTO recipe(id,user_id,title,content,origin) VALUES ('00000000-0000-4000-8000-000000000001','migration-user','Recipe 2','{"preserve":"recipe"}','manual');
    INSERT INTO recipe_import(id,user_id,fingerprint,input,source_url,state,generated) VALUES ('00000000-0000-4000-8000-000000000002','migration-user','fingerprint','private input','https://example.test','ready','{"preserve":"checkpoint"}');
    INSERT INTO meal_planner(user_id,meals,revision) VALUES ('migration-user','[{"preserve":"meal"}]',7);
    INSERT INTO shopping_item(id,user_id,text) VALUES ('00000000-0000-4000-8000-000000000003','migration-user','Preserve shopping');
    INSERT INTO billing_account(user_id,customer_id,status,trial_used) VALUES ('migration-user','customer-preserved','pro',true);
    INSERT INTO ai_spend(import_id,reserved_cents) VALUES ('00000000-0000-4000-8000-000000000002',25);
  `);
}
async function contents(client: pg.Client) {
  const tables = [
    "user",
    "recipe",
    "recipe_import",
    "meal_planner",
    "shopping_item",
    "billing_account",
    "ai_spend",
  ];
  const result = [];
  for (const table of tables) {
    result.push(
      (await client.query(`SELECT row_to_json(t) AS data FROM "${table}" t`))
        .rows,
    );
  }
  return result;
}

it("provisions a clean database with ICU and preserves all data on repeated migration/verification", async () => {
  await database(async (client, run) => {
    expect(run()).toContain("verified");
    await seed(client);
    const before = await contents(client);
    expect(run()).toContain("verified");
    expect(run("--verify")).toContain("verified");
    expect(await contents(client)).toEqual(before);
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS total FROM prep_sheet_migration",
        )
      ).rows[0].total,
    ).toBe(2);
    expect(
      (
        await client.query(
          "SELECT 'Recipe 2' COLLATE recipe_name < 'Recipe 10' AS natural",
        )
      ).rows[0].natural,
    ).toBe(true);
  });
});

it("requires explicit adoption and upgrades recorded legacy revisions/import fields without losing records", async () => {
  await database(async (client, run) => {
    await client.query(baseline);
    await seed(client);
    await client.query(`
      ALTER TABLE recipe DROP COLUMN revision;
      ALTER TABLE recipe_import DROP COLUMN source_kind, DROP COLUMN usage_released, DROP COLUMN usage_bucket, DROP COLUMN worker_token;
      ALTER TABLE recipe_import ALTER COLUMN source_url SET NOT NULL;
      ALTER TABLE billing_account RENAME CONSTRAINT billing_account_customer_id_unique TO billing_account_customer_id_key;
      ALTER TABLE billing_account RENAME CONSTRAINT billing_account_user_id_user_id_fk TO billing_account_user_id_fkey;
      ALTER INDEX recipe_user_created_idx RENAME TO legacy_recipe_user_index;
    `);
    const before = await contents(client);
    expect(() => run()).toThrow();
    expect(
      (
        await client.query(
          "SELECT to_regclass('prep_sheet_migration') AS ledger",
        )
      ).rows[0].ledger,
    ).toBeNull();
    expect(run("--adopt")).toContain("verified");
    expect(
      (
        await client.query(
          "SELECT to_regclass('recipe_user_created_idx') AS index",
        )
      ).rows[0].index,
    ).toBe("recipe_user_created_idx");
    expect(
      (
        await client.query(
          "SELECT conname FROM pg_constraint WHERE conrelid='billing_account'::regclass",
        )
      ).rows.map((row) => row.conname),
    ).toContain("billing_account_user_id_user_id_fk");
    const after = await contents(client);
    for (const [index, rows] of before.entries()) {
      for (const [rowIndex, row] of rows.entries())
        expect(after[index]?.[rowIndex]?.data).toMatchObject(row.data);
    }
    expect(run("--adopt")).toContain("verified");
  });
});

it("rolls back adoption upgrades when a constraint or default is incompatible", async () => {
  await database(async (client, run) => {
    await client.query(baseline);
    await seed(client);
    await client.query(
      "ALTER TABLE recipe DROP COLUMN revision; ALTER TABLE recipe_rating DROP CONSTRAINT recipe_rating_value_check; ALTER TABLE shopping_item ALTER COLUMN status SET DEFAULT 'bought'",
    );
    const before = await contents(client);
    expect(() => run("--adopt")).toThrow();
    expect(await contents(client)).toEqual(before);
    expect(
      (
        await client.query(
          "SELECT to_regclass('prep_sheet_migration') AS ledger",
        )
      ).rows[0].ledger,
    ).toBeNull();
    expect(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='recipe' AND column_name='revision'",
        )
      ).rowCount,
    ).toBe(0);
  });
});

it("refuses changed migration hashes and incorrectly defined ICU collations", async () => {
  await database(async (client, run) => {
    run();
    await client.query(
      "UPDATE prep_sheet_migration SET hash='wrong' WHERE name LIKE '0000%'",
    );
    expect(() => run()).toThrow();
  });
  await database(async (client, run) => {
    await client.query(baseline);
    await client.query(
      "CREATE COLLATION recipe_name (provider=icu, locale='en', deterministic=true)",
    );
    expect(() => run("--adopt")).toThrow();
    expect(
      (
        await client.query(
          "SELECT to_regclass('prep_sheet_migration') AS ledger",
        )
      ).rows[0].ledger,
    ).toBeNull();
  });
});
