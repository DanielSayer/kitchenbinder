import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
  const image = process.env.PREP_SHEET_RELEASE_IMAGE;
  const containerUrl = new URL(url.href);
  const network =
    process.platform === "linux"
      ? "--network=host"
      : "--add-host=host.docker.internal:host-gateway";
  if (process.platform !== "linux")
    containerUrl.hostname = "host.docker.internal";
  const run = (...args: string[]) =>
    execFileSync(
      image ? "docker" : process.execPath,
      image
        ? [
            "run",
            "--rm",
            network,
            "-e",
            `DATABASE_URL=${containerUrl.href}`,
            image,
            "node",
            "packages/db/scripts/migrate.mjs",
            ...args,
          ]
        : [runner, ...args],
      {
        env: { ...process.env, DATABASE_URL: url.href },
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  try {
    await test(client, run);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  }
}

const migrationNames = [
  "0000_production_baseline.sql",
  "0001_recipe_name.sql",
  "0002_import_save_retries.sql",
  "0003_manual_request_identity.sql",
  "0004_auth_rate_limit.sql",
  "0005_collection_recipe_tags.sql",
  "0006_households.sql",
  "0007_household_constraint_names.sql",
];
async function applyRecorded(client: pg.Client, names: string[]) {
  await client.query(
    "CREATE TABLE IF NOT EXISTS prep_sheet_migration (name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of names) {
    const migrationSql = readFileSync(
      new URL(`./migrations/${name}`, import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    await client.query(migrationSql);
    await client.query(
      "INSERT INTO prep_sheet_migration(name,hash) VALUES ($1,$2)",
      [name, createHash("sha256").update(migrationSql).digest("hex")],
    );
  }
}

async function seed(client: pg.Client) {
  const households = (
    await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='household' AND column_name='personal') AS present",
    )
  ).rows[0].present;
  const lists = households
    ? `INSERT INTO household(id,name,owner_id,personal) VALUES ('00000000-0000-4000-8000-000000000009','Just me','migration-user',true);
    INSERT INTO household_member(household_id,user_id) VALUES ('00000000-0000-4000-8000-000000000009','migration-user');
    INSERT INTO meal_planner(household_id,meals,revision) VALUES ('00000000-0000-4000-8000-000000000009','[{"preserve":"meal"}]',7);
    INSERT INTO shopping_item(id,household_id,added_by,text) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000009','migration-user','Preserve shopping');`
    : `INSERT INTO meal_planner(user_id,meals,revision) VALUES ('migration-user','[{"preserve":"meal"}]',7);
    INSERT INTO shopping_item(id,user_id,text) VALUES ('00000000-0000-4000-8000-000000000003','migration-user','Preserve shopping');`;
  await client.query(`
    INSERT INTO "user" (id,name,email) VALUES ('migration-user','Existing person','migration@example.test');
    INSERT INTO recipe(id,user_id,title,content,origin) VALUES ('00000000-0000-4000-8000-000000000001','migration-user','Recipe 2','{"preserve":"recipe"}','manual');
    INSERT INTO recipe_import(id,user_id,fingerprint,input,source_url,state,generated) VALUES ('00000000-0000-4000-8000-000000000002','migration-user','fingerprint','private input','https://example.test','ready','{"preserve":"checkpoint"}');
    ${lists}
    INSERT INTO billing_account(user_id,customer_id,status,trial_used) VALUES ('migration-user','customer-preserved','pro',true);
    INSERT INTO ai_spend(import_id,reserved_cents) VALUES ('00000000-0000-4000-8000-000000000002',25);
  `);
}
// Stable projections across 0008, which moves personal plans/lists to households,
// and 0009, which adds empty photo columns.
const projections: [string, string][] = [
  ["user", "row_to_json(t)::jsonb"],
  ["recipe", "row_to_json(t)::jsonb - 'group_id' - 'photo'"],
  [
    "recipe_import",
    "row_to_json(t)::jsonb - 'group_id' - 'household_id' - 'collection_id' - 'image_candidates'",
  ],
  ["meal_planner", "row_to_json(t)::jsonb - 'user_id' - 'household_id' - 'id'"],
  [
    "shopping_item",
    "row_to_json(t)::jsonb - 'user_id' - 'added_by' - 'household_id'",
  ],
  ["billing_account", "row_to_json(t)::jsonb"],
  ["ai_spend", "row_to_json(t)::jsonb"],
];
async function contents(client: pg.Client) {
  const result = [];
  for (const [table, projection] of projections) {
    result.push(
      (await client.query(`SELECT ${projection} AS data FROM "${table}" t`))
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
    ).toBe(11);
    expect(
      (
        await client.query(
          "SELECT 'Recipe 2' COLLATE recipe_name < 'Recipe 10' AS natural",
        )
      ).rows[0].natural,
    ).toBe(true);
  });
}, 60_000);

it.each([2, 4])(
  "upgrades a database with %i published migrations while preserving checkpoints and user data",
  async (published) => {
    await database(async (client, run) => {
      await client.query(`CREATE TABLE prep_sheet_migration (
      name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
      for (const name of [
        "0000_production_baseline.sql",
        "0001_recipe_name.sql",
        "0002_import_save_retries.sql",
        "0003_manual_request_identity.sql",
      ].slice(0, published)) {
        const sql = readFileSync(
          new URL(`./migrations/${name}`, import.meta.url),
          "utf8",
        ).replaceAll("\r\n", "\n");
        await client.query(sql);
        await client.query(
          "INSERT INTO prep_sheet_migration(name,hash) VALUES ($1,$2)",
          [name, createHash("sha256").update(sql).digest("hex")],
        );
      }
      await seed(client);
      const before = await contents(client);
      expect(() => run("--verify")).toThrow();
      expect(run()).toContain("verified");
      const after = await contents(client);
      for (const [index, rows] of before.entries()) {
        for (const [rowIndex, row] of rows.entries())
          expect(after[index]?.[rowIndex]?.data).toMatchObject(row.data);
      }
      const retry = await client.query(
        "SELECT save_attempts, next_save_attempt_at, save_claimed_at FROM recipe_import",
      );
      expect(retry.rows[0]).toMatchObject({
        save_attempts: 0,
        save_claimed_at: null,
      });
      expect(retry.rows[0].next_save_attempt_at).toBeInstanceOf(Date);
      expect(
        (await client.query("SELECT manual_request_hash FROM recipe")).rows[0]
          .manual_request_hash,
      ).toBeNull();
      expect(run("--verify")).toContain("verified");
      expect(run()).toContain("verified");
      expect(await contents(client)).toEqual(after);
    });
  },
  60_000,
);

it("adopts recorded feature upgrades without resetting retry leases, manual identities or data", async () => {
  await database(async (client, run) => {
    await client.query(baseline);
    await seed(client);
    for (const name of [
      "import-save-retries.sql",
      "edit-loss-manual-request.sql",
    ])
      await client.query(
        readFileSync(new URL(`./upgrades/${name}`, import.meta.url), "utf8"),
      );
    await client.query(`UPDATE recipe SET manual_request_hash='original-immutable-hash';
      UPDATE recipe_import SET save_attempts=3, next_save_attempt_at='2026-10-14T05:00:00Z', save_claimed_at='2026-10-14T04:59:00Z', worker_token='00000000-0000-4000-8000-000000000004'`);
    const before = await contents(client);
    expect(run("--adopt")).toContain("verified");
    expect(await contents(client)).toEqual(before);
    expect(run("--verify")).toContain("verified");
  });
}, 60_000);

it("rejects incompatible pre-existing feature columns without stamping or applying partial upgrades", async () => {
  await database(async (client, run) => {
    await client.query(baseline);
    await seed(client);
    await client.query(
      "ALTER TABLE recipe_import ADD COLUMN save_attempts integer NOT NULL DEFAULT 99",
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
          "SELECT column_name FROM information_schema.columns WHERE table_name='recipe' AND column_name='manual_request_hash'",
        )
      ).rowCount,
    ).toBe(0);
  });
}, 60_000);

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
}, 60_000);

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
}, 60_000);

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
  await database(async (client, run) => {
    run();
    await client.query("DROP COLLATION public.recipe_name");
    expect(() => run("--verify")).toThrow();
    expect(
      (
        await client.query(
          "SELECT to_regcollation('public.recipe_name') AS collation",
        )
      ).rows[0].collation,
    ).toBeNull();
  });
}, 60_000);

it("migrates all members' recipe tags, deduplicates assignments and retains shared tags after account deletion", async () => {
  await database(async (client, run) => {
    await applyRecorded(client, migrationNames.slice(0, 5));
    await seed(client);
    await client.query(`
      INSERT INTO "user" (id,name,email) VALUES ('tag-member','Member','tag-member@example.test');
      INSERT INTO "group" (id,name,owner_id) VALUES ('10000000-0000-4000-8000-000000000001','Shared','migration-user');
      INSERT INTO group_member (group_id,user_id) VALUES ('10000000-0000-4000-8000-000000000001','migration-user'), ('10000000-0000-4000-8000-000000000001','tag-member');
      INSERT INTO recipe (id,user_id,group_id,title,content,origin) VALUES ('10000000-0000-4000-8000-000000000002','tag-member','10000000-0000-4000-8000-000000000001','Shared recipe','{}','manual');
      INSERT INTO tag (id,user_id,name,description) VALUES ('20000000-0000-4000-8000-000000000001','migration-user','Lunch','Pack cold'), ('20000000-0000-4000-8000-000000000002','tag-member','LUNCH','Other description'), ('20000000-0000-4000-8000-000000000003',NULL,'Built in','Global');
      INSERT INTO recipe_tag (user_id,recipe_id,tag_id) VALUES
        ('migration-user','00000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),
        ('migration-user','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'),
        ('tag-member','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002'),
        ('migration-user','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'),
        ('tag-member','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
    `);
    await client.query(`INSERT INTO tag (id,user_id,name,description) VALUES ('20000000-0000-4000-8000-000000000004','tag-member','Checkpoint only','Preserve pending tag');
      UPDATE recipe_import SET group_id='10000000-0000-4000-8000-000000000001', generated='{"preserve":"checkpoint","tagIds":["20000000-0000-4000-8000-000000000002","20000000-0000-4000-8000-000000000004"]}'`);
    await applyRecorded(client, migrationNames.slice(5, 6));
    const checkpoint = (
      await client.query("SELECT generated FROM recipe_import")
    ).rows[0].generated;
    expect(checkpoint.preserve).toBe("checkpoint");
    const checkpointTags = await client.query(
      "SELECT name, user_id, group_id FROM tag WHERE id = ANY($1::uuid[]) ORDER BY name",
      [checkpoint.tagIds],
    );
    expect(checkpointTags.rows).toEqual([
      {
        name: "Checkpoint only",
        user_id: null,
        group_id: "10000000-0000-4000-8000-000000000001",
      },
      {
        name: "Lunch",
        user_id: null,
        group_id: "10000000-0000-4000-8000-000000000001",
      },
    ]);
    const applied = await client.query(
      `SELECT t.name,t.description,t.user_id,t.group_id FROM recipe_tag rt JOIN tag t ON t.id=rt.tag_id WHERE rt.recipe_id='10000000-0000-4000-8000-000000000002' ORDER BY t.name`,
    );
    expect(applied.rows).toEqual([
      {
        name: "Built in",
        description: "Global",
        user_id: null,
        group_id: null,
      },
      {
        name: "Lunch",
        description: "Pack cold",
        user_id: null,
        group_id: "10000000-0000-4000-8000-000000000001",
      },
    ]);
    expect(
      (
        await client.query(
          `SELECT tag_id FROM recipe_tag WHERE recipe_id='00000000-0000-4000-8000-000000000001'`,
        )
      ).rows,
    ).toEqual([{ tag_id: "20000000-0000-4000-8000-000000000001" }]);
    await client.query(`DELETE FROM "user" WHERE id='tag-member'`);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS total FROM recipe_tag WHERE recipe_id='10000000-0000-4000-8000-000000000002'`,
        )
      ).rows[0].total,
    ).toBe(2);
    expect(run()).toContain("verified");
    // 0008: the orphaned group recipe moves to the group owner and merges tags.
    expect(
      (
        await client.query(
          `SELECT rt.tag_id FROM recipe_tag rt WHERE rt.recipe_id='10000000-0000-4000-8000-000000000002' ORDER BY rt.tag_id`,
        )
      ).rows,
    ).toEqual([
      { tag_id: "20000000-0000-4000-8000-000000000001" },
      { tag_id: "20000000-0000-4000-8000-000000000003" },
    ]);
  });
}, 60_000);

it("0008 converts groups to households and preserves recipes, tags, plans, lists and imports", async () => {
  const g = "30000000-0000-4000-8000-000000000001";
  const r = (n: number) => `31000000-0000-4000-8000-00000000000${n}`;
  const t = (n: number) => `32000000-0000-4000-8000-00000000000${n}`;
  const personal = (id: string) => {
    const hex = createHash("md5").update(`personal:${id}`).digest("hex");
    return `${hex.slice(0, 12)}4${hex.slice(13, 16)}8${hex.slice(17)}`;
  };
  const uuid = (hex: string) =>
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  await database(async (client, run) => {
    await applyRecorded(client, migrationNames);
    await client.query(`
      INSERT INTO "user" (id,name,email,created_at) VALUES
        ('h-owner','Owner','h-owner@example.test','2026-01-01'),
        ('h-member','Member','h-member@example.test','2026-01-02'),
        ('h-gone','Gone','h-gone@example.test','2026-01-03'),
        ('h-solo','Solo','h-solo@example.test','2026-01-04');
      INSERT INTO "group" (id,name,owner_id,created_at) VALUES ('${g}','Family','h-owner','2026-02-01');
      INSERT INTO group_member (group_id,user_id,joined_at) VALUES
        ('${g}','h-owner','2026-02-01'),('${g}','h-member','2026-02-02'),('${g}','h-gone','2026-02-03');
      INSERT INTO recipe (id,user_id,group_id,title,content,origin) VALUES
        ('${r(1)}','h-member','${g}','Member soup','{}','manual'),
        ('${r(2)}','h-gone','${g}','Orphan stew','{}','manual'),
        ('${r(3)}','h-owner',NULL,'Personal pie','{}','manual');
      INSERT INTO recipe (id,user_id,group_id,title,content,origin,deleted_at,deleted_by,expires_at) VALUES
        ('${r(4)}','h-owner','${g}','Deleted cake','{}','manual',now(),'h-owner',now() + interval '30 days');
      INSERT INTO tag (id,user_id,group_id,name,description) VALUES
        ('${t(1)}','h-member',NULL,'Lunch','Member lunch'),
        ('${t(2)}','h-owner',NULL,'spicy','Owner spicy'),
        ('${t(3)}',NULL,'${g}','LUNCH','Group lunch'),
        ('${t(4)}',NULL,'${g}','Spicy','Group spicy'),
        ('${t(5)}',NULL,'${g}','Unused','Nobody'),
        ('${t(6)}',NULL,NULL,'Built in','Global');
      INSERT INTO recipe_tag (recipe_id,tag_id) VALUES
        ('${r(1)}','${t(3)}'),('${r(1)}','${t(4)}'),('${r(1)}','${t(6)}'),
        ('${r(2)}','${t(3)}'),('${r(2)}','${t(4)}'),
        ('${r(3)}','${t(2)}');
      INSERT INTO meal_planner (user_id,meals,revision) VALUES
        ('h-owner','[{"preserve":"owner meal"}]',3),('h-member','[{"preserve":"member meal"}]',5);
      INSERT INTO shopping_item (id,user_id,text,status) VALUES
        ('${r(5)}','h-owner','Flour','bought'),('${r(6)}','h-member','Milk','needed');
      INSERT INTO shopping_plan (user_id,id,content,sources,generated_at) VALUES
        ('h-owner','${r(7)}','{"groups":[]}','[{"id":"${r(5)}","text":"Flour"}]','2026-03-01');
      INSERT INTO recipe_import (id,user_id,group_id,fingerprint,input,state,generated) VALUES
        ('${r(8)}','h-member','${g}','fp','', 'ready','{"preserve":"checkpoint","tagIds":["${t(3)}","${t(6)}"]}');
      DELETE FROM "user" WHERE id='h-gone';
    `);
    expect(run()).toContain("verified");
    expect(run("--verify")).toContain("verified");

    const households = await client.query(
      "SELECT id,name,owner_id,personal,color FROM household ORDER BY personal, owner_id",
    );
    expect(households.rows).toEqual([
      {
        id: g,
        name: "Family",
        owner_id: "h-owner",
        personal: false,
        color: "tomato",
      },
      ...["h-member", "h-owner", "h-solo"].map((id) => ({
        id: uuid(personal(id)),
        name: "Just me",
        owner_id: id,
        personal: true,
        color: "sage",
      })),
    ]);
    expect(
      (
        await client.query(
          "SELECT household_id,user_id FROM household_member ORDER BY household_id, user_id",
        )
      ).rows,
    ).toEqual(
      [
        { household_id: g, user_id: "h-member" },
        { household_id: g, user_id: "h-owner" },
        ...["h-member", "h-owner", "h-solo"].map((id) => ({
          household_id: uuid(personal(id)),
          user_id: id,
        })),
      ].sort((a, b) => {
        const left = [a.household_id, a.user_id];
        const right = [b.household_id, b.user_id];
        return left < right ? -1 : 1;
      }),
    );

    const recipes = await client.query(
      `SELECT r.id, r.user_id, r.deleted_at IS NOT NULL AS deleted,
        coalesce((SELECT json_agg(household_id) FROM recipe_share s WHERE s.recipe_id = r.id), '[]') AS shares
       FROM recipe r ORDER BY r.id`,
    );
    expect(recipes.rows).toEqual([
      { id: r(1), user_id: "h-member", deleted: false, shares: [g] },
      { id: r(2), user_id: "h-owner", deleted: false, shares: [g] },
      { id: r(3), user_id: "h-owner", deleted: false, shares: [] },
      { id: r(4), user_id: "h-owner", deleted: true, shares: [g] },
    ]);

    const tags = await client.query(
      `SELECT t.user_id, t.name, t.description,
        coalesce((SELECT json_agg(rt.recipe_id ORDER BY rt.recipe_id) FROM recipe_tag rt WHERE rt.tag_id = t.id), '[]') AS recipes
       FROM tag t WHERE t.user_id IS NOT NULL OR t.name = 'Built in' ORDER BY t.user_id NULLS FIRST, lower(t.name)`,
    );
    expect(tags.rows).toEqual([
      {
        user_id: null,
        name: "Built in",
        description: "Global",
        recipes: [r(1)],
      },
      {
        user_id: "h-member",
        name: "Lunch",
        description: "Member lunch",
        recipes: [r(1)],
      },
      {
        user_id: "h-member",
        name: "Spicy",
        description: "Group spicy",
        recipes: [r(1)],
      },
      {
        user_id: "h-owner",
        name: "LUNCH",
        description: "Group lunch",
        recipes: [r(2)],
      },
      {
        user_id: "h-owner",
        name: "spicy",
        description: "Owner spicy",
        recipes: [r(2), r(3)],
      },
    ]);
    expect(
      (
        await client.query(
          `SELECT count(*)::int AS total FROM tag WHERE name IN ('Unused')`,
        )
      ).rows[0].total,
    ).toBe(0);

    const plans = await client.query(
      "SELECT household_id, meals, revision FROM meal_planner ORDER BY revision",
    );
    expect(plans.rows).toEqual([
      {
        household_id: uuid(personal("h-owner")),
        meals: [{ preserve: "owner meal" }],
        revision: 3,
      },
      {
        household_id: uuid(personal("h-member")),
        meals: [{ preserve: "member meal" }],
        revision: 5,
      },
    ]);
    expect(
      (
        await client.query(
          "SELECT id, household_id, added_by, text, status FROM shopping_item ORDER BY id",
        )
      ).rows,
    ).toEqual([
      {
        id: r(5),
        household_id: uuid(personal("h-owner")),
        added_by: "h-owner",
        text: "Flour",
        status: "bought",
      },
      {
        id: r(6),
        household_id: uuid(personal("h-member")),
        added_by: "h-member",
        text: "Milk",
        status: "needed",
      },
    ]);
    expect(
      (
        await client.query(
          "SELECT household_id, id, sources FROM shopping_plan",
        )
      ).rows,
    ).toEqual([
      {
        household_id: uuid(personal("h-owner")),
        id: r(7),
        sources: [{ id: r(5), text: "Flour" }],
      },
    ]);

    const [job] = (
      await client.query(
        "SELECT household_id, collection_id, generated FROM recipe_import",
      )
    ).rows;
    expect(job).toMatchObject({ household_id: g, collection_id: null });
    expect(job.generated.preserve).toBe("checkpoint");
    expect([...job.generated.tagIds].sort()).toEqual([t(1), t(6)].sort());
    expect(
      (await client.query("SELECT count(*)::int AS total FROM collection"))
        .rows[0].total,
    ).toBe(0);
    // Generated ids must pass the API's RFC 4122 uuid validation.
    const ids = await client.query(
      "SELECT id::text FROM household UNION ALL SELECT id::text FROM tag",
    );
    for (const { id } of ids.rows)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

    // Deleting the household removes access, not the members' recipes.
    await client.query(`DELETE FROM household WHERE id='${g}'`);
    expect(
      (await client.query("SELECT count(*)::int AS total FROM recipe")).rows[0]
        .total,
    ).toBe(4);
  });
}, 60_000);

it.each([6, 7])(
  "upgrades published household migration 000%i without losing personal or shared plans, lists, memberships or invitations",
  async (lastPublished) => {
    await database(async (client, run) => {
      await applyRecorded(client, migrationNames.slice(0, lastPublished + 1));
      await seed(client);
      const shared = "40000000-0000-4000-8000-000000000001";
      const group = "40000000-0000-4000-8000-000000000002";
      await client.query(`
        INSERT INTO household(id,name,owner_id,created_at) VALUES ('${shared}','Existing household','migration-user','2026-01-01');
        INSERT INTO household_member(household_id,user_id,joined_at) VALUES ('${shared}','migration-user','2026-01-02');
        INSERT INTO household_invite(id,household_id,token_hash,expires_at,revoked_at) VALUES
          ('40000000-0000-4000-8000-000000000003','${shared}','existing-household-token','2030-01-01','2026-01-03');
        INSERT INTO "group"(id,name,owner_id) VALUES ('${group}','Existing recipe group','migration-user');
        INSERT INTO group_member(group_id,user_id) VALUES ('${group}','migration-user');
        INSERT INTO group_invite(id,group_id,token_hash,expires_at,accepted_at) VALUES
          ('40000000-0000-4000-8000-000000000004','${group}','existing-group-token','2030-01-01','2026-01-04');
        INSERT INTO meal_planner(household_id,meals,revision,trip) VALUES
          ('${shared}','[{"id":"shared-meal","snapshot":{"title":"Preserve private recipe snapshot"},"leftoverOf":"earlier-meal"}]',23,'{"preserve":"shared trip"}');
        INSERT INTO shopping_item(id,household_id,text,status,recipe_title,position) VALUES
          ('40000000-0000-4000-8000-000000000005','${shared}','Shared milk','owned','Private recipe',4);
        INSERT INTO shopping_plan(user_id,id,content,sources,generated_at) VALUES
          ('migration-user','40000000-0000-4000-8000-000000000006','{"preserve":"personal plan"}','[]','2026-01-05');
        INSERT INTO shopping_plan(household_id,id,content,sources,generated_at) VALUES
          ('${shared}','40000000-0000-4000-8000-000000000007','{"preserve":"shared plan"}','[{"preserve":"shared source"}]','2026-01-06');
      `);
      const beforePersonal = await contents(client);
      const sharedPlan = (
        await client.query(
          "SELECT household_id,meals,revision,trip FROM meal_planner WHERE household_id=$1",
          [shared],
        )
      ).rows;
      const sharedItems = (
        await client.query(
          "SELECT row_to_json(t)::jsonb - 'user_id' AS data FROM shopping_item t WHERE household_id=$1",
          [shared],
        )
      ).rows;
      const sharedShopping = (
        await client.query(
          "SELECT row_to_json(t)::jsonb - 'user_id' AS data FROM shopping_plan t WHERE household_id=$1",
          [shared],
        )
      ).rows;
      const invitations = (
        await client.query(`
        SELECT id,household_id,token_hash,created_at,expires_at,revoked_at,accepted_at FROM household_invite
        UNION ALL SELECT id,group_id,token_hash,created_at,expires_at,revoked_at,accepted_at FROM group_invite ORDER BY id
      `)
      ).rows;
      expect(() => run("--verify")).toThrow();
      expect(run()).toContain("verified");
      expect(run("--verify")).toContain("verified");
      expect(run()).toContain("verified");

      const afterPersonal = await contents(client);
      for (const [index, rows] of beforePersonal.entries()) {
        for (const row of rows) {
          expect(afterPersonal[index]).toContainEqual(row);
        }
      }
      expect(
        (
          await client.query(
            "SELECT household_id,meals,revision,trip FROM meal_planner WHERE household_id=$1",
            [shared],
          )
        ).rows,
      ).toEqual(sharedPlan);
      expect(
        (
          await client.query(
            "SELECT row_to_json(t)::jsonb - 'added_by' AS data FROM shopping_item t WHERE household_id=$1",
            [shared],
          )
        ).rows,
      ).toEqual(sharedItems);
      expect(
        (
          await client.query(
            "SELECT row_to_json(t)::jsonb AS data FROM shopping_plan t WHERE household_id=$1",
            [shared],
          )
        ).rows,
      ).toEqual(sharedShopping);
      expect(
        (await client.query("SELECT * FROM household_invite ORDER BY id")).rows,
      ).toEqual(invitations);
      expect(
        (
          await client.query(
            "SELECT household_id FROM household_member WHERE user_id='migration-user' ORDER BY household_id",
          )
        ).rows,
      ).toHaveLength(3);
      expect(
        (
          await client.query(
            "SELECT id,name,owner_id,personal FROM household WHERE NOT personal ORDER BY id",
          )
        ).rows,
      ).toEqual([
        {
          id: shared,
          name: "Existing household",
          owner_id: "migration-user",
          personal: false,
        },
        {
          id: group,
          name: "Existing recipe group",
          owner_id: "migration-user",
          personal: false,
        },
      ]);
      expect(
        (
          await client.query(
            "SELECT p.content FROM shopping_plan p JOIN household h ON h.id=p.household_id WHERE h.personal AND h.owner_id='migration-user'",
          )
        ).rows,
      ).toEqual([{ content: { preserve: "personal plan" } }]);
      expect(
        (await client.query("SELECT to_regclass('public.group') AS old_group"))
          .rows[0].old_group,
      ).toBeNull();
    });
  },
  60_000,
);

it("keeps the published household SQL hashes unchanged", () => {
  // These hashes are already recorded in deployed/local databases. Changes must
  // be a new migration rather than an edit to either published file.
  for (const [name, expected] of [
    [
      "0006_households.sql",
      "a603dfde1b1b9fc4b54fa5c1e20b584b3f9c410fab1a75b9829bfb3e5a884044",
    ],
    [
      "0007_household_constraint_names.sql",
      "769bf5ae63ca0a4597bf0d1c02a0c749732415e18113d52c3ca2ad82e0900b90",
    ],
  ]) {
    const sql = readFileSync(
      new URL(`./migrations/${name}`, import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(sql).digest("hex")).toBe(expected);
  }
});

it("removes browser credentials while preserving recipes and admitted imports", async () => {
  await database(async (client, run) => {
    await applyRecorded(client, [
      ...migrationNames,
      "0008_pantry_households.sql",
      "0009_recipe_photo.sql",
    ]);
    await seed(client);
    await client.query(`
      INSERT INTO extension_credential(id,token_hash,user_id,extension_id,scope,expires_at)
      VALUES ('old-credential','old-token-hash','migration-user','old-browser','recipes:import','2030-01-01');
      INSERT INTO extension_grant(code_hash,user_id,extension_id,redirect_uri,challenge,state,expires_at)
      VALUES ('old-code-hash','migration-user','old-browser','https://callback.test','challenge','state','2030-01-01');
      INSERT INTO extension_rate(user_id,"window",requests) VALUES ('migration-user',now(),10);
    `);
    const before = await contents(client);
    expect(run()).toContain("verified");
    expect(run("--verify")).toContain("verified");
    expect(await contents(client)).toEqual(before);
    expect(
      (
        await client.query(`SELECT
      to_regclass('public.extension_credential') AS credential,
      to_regclass('public.extension_grant') AS grant,
      to_regclass('public.extension_rate') AS rate
    `)
      ).rows,
    ).toEqual([{ credential: null, grant: null, rate: null }]);
    expect(
      (
        await client.query(`
      INSERT INTO recipe_import(id,user_id,fingerprint,input)
      VALUES ('00000000-0000-4000-8000-000000000010','migration-user','new-request','Soup')
      RETURNING source_kind
    `)
      ).rows,
    ).toEqual([{ source_kind: "website" }]);
  });
}, 60_000);
