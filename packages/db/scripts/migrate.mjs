import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const directory = new URL("../src/migrations/", import.meta.url);
const files = readdirSync(directory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
export const migrations = files.map((name) => {
  // Git checkouts can use CRLF on Windows. Hash the same SQL on every host.
  const sql = readFileSync(new URL(name, directory), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  return { name, sql, hash: createHash("sha256").update(sql).digest("hex") };
});

export function connect(connectionString) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
}

async function checkCollation(client) {
  const result = await client.query(`
    SELECT collprovider, collisdeterministic,
      coalesce(to_jsonb(c)->>'colllocale', to_jsonb(c)->>'colliculocale') AS colliculocale,
      collversion = pg_collation_actual_version(oid) AS version_ok
    FROM pg_collation c WHERE oid = to_regcollation('public.recipe_name')`);
  const row = result.rows[0];
  if (
    row?.collprovider !== "i" ||
    row.collisdeterministic ||
    !["und-u-kn-true-ks-level1", "und-u-kn-ks-level1"].includes(
      row.colliculocale,
    ) ||
    !row.version_ok
  ) {
    throw new Error(
      `recipe_name requires matching ICU locale and version; repair/reindex before release: ${JSON.stringify(row)}`,
    );
  }
  const semantics = await client.query(`SELECT
    'Recipe 2' COLLATE public.recipe_name < 'Recipe 10' AS numeric,
    'Crème' COLLATE public.recipe_name = 'creme' AS base`);
  if (!semantics.rows[0].numeric || !semantics.rows[0].base) {
    throw new Error("recipe_name ICU comparison is incompatible");
  }
}

export async function checkRelease(client) {
  const result = await client.query(
    "SELECT name, hash FROM public.prep_sheet_migration ORDER BY name",
  );
  if (
    JSON.stringify(result.rows) !==
    JSON.stringify(migrations.map(({ name, hash }) => ({ name, hash })))
  ) {
    throw new Error("Database migration history does not match this release");
  }
  await checkCollation(client);
}

// Compare semantics, ignoring historical names assigned to equivalent constraints/indexes.
async function catalogue(client, schema) {
  const result = await client.query(
    `
    SELECT c.relname AS table_name, a.attname AS name, 'column' AS kind,
      format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' ||
      coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':identity=' || a.attidentity::text ||
      ':generated=' || a.attgenerated::text || ':collation=' || a.attcollation::regcollation::text AS definition
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND c.relname<>'prep_sheet_migration'
    UNION ALL
    SELECT c.relname, '', 'relation', c.relkind::text || ':rls=' || c.relrowsecurity || ':force=' || c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','S','f') AND c.relname<>'prep_sheet_migration'
    UNION ALL
    SELECT c.relname, '', 'trigger', pg_get_triggerdef(t.oid)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND NOT t.tgisinternal
    UNION ALL
    SELECT c.relname, '', 'policy', p.polcmd::text || ':' || p.polroles::text || ':' ||
      p.polpermissive || ':' || coalesce(pg_get_expr(p.polqual,p.polrelid),'') || ':' ||
      coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1
    UNION ALL
    SELECT c.relname, '', 'constraint', pg_get_constraintdef(k.oid)
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname<>'prep_sheet_migration'
    UNION ALL
    SELECT c.relname, '', 'index', substring(pg_get_indexdef(i.indexrelid) FROM ' USING .*$') ||
      ':unique=' || i.indisunique || ':valid=' || i.indisvalid
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname<>'prep_sheet_migration'`,
    [schema],
  );
  return result.rows
    .map((row) =>
      JSON.stringify(row)
        .replaceAll(`${schema}.`, "")
        .replaceAll("public.", ""),
    )
    .sort();
}

async function verifySchema(client) {
  const schema = `release_check_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET LOCAL search_path TO "${schema}", public`);
  for (const migration of migrations) {
    // Migration SQL is tracked release code, never external/user input.
    await client.query(migration.sql.replaceAll('"public".', `"${schema}".`));
  }
  const expected = await catalogue(client, schema);
  const actual = await catalogue(client, "public");
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const missing = expected.filter((item) => !actual.includes(item));
    const extra = actual.filter((item) => !expected.includes(item));
    throw new Error(
      `Schema mismatch. Missing: ${missing.join("; ")}. Unexpected: ${extra.join("; ")}`,
    );
  }
  await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  await client.query("SET LOCAL search_path TO public");
}

export async function migrate(
  client,
  { adopt = false, verifyOnly = false } = {},
) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT pg_advisory_xact_lock(79231202)");
    await client.query("SET LOCAL search_path TO public");
    const version = await client.query("SHOW server_version_num");
    if (
      Number(version.rows[0].server_version_num) < 180000 ||
      Number(version.rows[0].server_version_num) >= 190000
    ) {
      throw new Error("This release is verified on PostgreSQL 18 with ICU");
    }
    const history = await client.query(
      "SELECT to_regclass('public.prep_sheet_migration') AS present",
    );
    const existing = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    if (!history.rows[0].present) {
      if (verifyOnly)
        throw new Error("Database has no release migration history");
      if (existing.rowCount && !adopt)
        throw new Error(
          "Existing database requires explicit --adopt and a backup",
        );
      if (existing.rowCount) {
        for (const name of [
          "recipe-revisions.sql",
          "reliable-imports.sql",
          "billing.sql",
          "recipe-list.sql",
        ]) {
          const sql = readFileSync(
            new URL(`../src/upgrades/${name}`, import.meta.url),
            "utf8",
          ).replace(/^BEGIN;|^COMMIT;/gm, "");
          await client.query(sql);
        }
      } else {
        for (const migration of migrations) await client.query(migration.sql);
      }
      await verifySchema(client);
      await client.query(`CREATE TABLE public.prep_sheet_migration (
        name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      for (const { name, hash } of migrations) {
        await client.query(
          "INSERT INTO public.prep_sheet_migration(name,hash) VALUES ($1,$2)",
          [name, hash],
        );
      }
    } else {
      const applied = await client.query(
        "SELECT name,hash FROM public.prep_sheet_migration ORDER BY name",
      );
      for (const [index, row] of applied.rows.entries()) {
        if (
          row.name !== migrations[index]?.name ||
          row.hash !== migrations[index]?.hash
        ) {
          throw new Error("Unknown or changed migration history");
        }
      }
      if (!verifyOnly) {
        for (const migration of migrations.slice(applied.rowCount)) {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO public.prep_sheet_migration(name,hash) VALUES ($1,$2)",
            [migration.name, migration.hash],
          );
        }
      }
      await verifySchema(client);
    }
    await checkRelease(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const client = connect(process.env.DATABASE_URL);
  try {
    await client.connect();
    await migrate(client, {
      adopt: process.argv.includes("--adopt"),
      verifyOnly: process.argv.includes("--verify"),
    });
    console.info("Release database verified.");
  } catch (error) {
    // Connection errors can contain credentials. Only report our own validation messages.
    console.error(
      error instanceof Error && !("code" in error)
        ? error.message
        : "Database migration failed; inspect PostgreSQL diagnostics securely.",
    );
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
