import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { checkRelease, connect } from "../packages/db/scripts/migrate.mjs";
import { ownContainer } from "./disposable-container.mjs";

function command(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 60_000,
    stdio: "pipe",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error("Recovery container command failed");
  return result.stdout.trim();
}

// A restore destination URL is deliberately not an input. Every run owns a fresh
// loopback-only, disposable PG18 server, tmpfs data and random credentials.
export async function rehearseRecovery({
  archive,
  adopt = false,
  accept = async () => {},
}) {
  const name = `prep-sheet-recovery-${randomUUID()}`;
  const removeContainer = ownContainer(name);
  const password = randomUUID();
  const started = Date.now();
  try {
    command(
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--label",
        "prep-sheet.disposable=recovery",
        "--publish",
        "127.0.0.1::5432",
        "--tmpfs",
        "/var/lib/postgresql:rw",
        "-e",
        "POSTGRES_DB=recovery",
        "-e",
        "POSTGRES_PASSWORD",
        "postgres:18",
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password } },
    );
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const probe = spawnSync(
        "docker",
        ["exec", name, "pg_isready", "-U", "postgres", "-d", "recovery"],
        { stdio: "ignore", timeout: 3000 },
      );
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await setTimeout(500);
    }
    if (!ready) throw new Error("Recovery server did not start");
    const binding = command(["port", name, "5432"]);
    const port = Number(binding.match(/:(\d+)$/)?.[1]);
    if (!port || port === 5432)
      throw new Error("Isolated recovery port required");
    const url = `postgresql://postgres:${password}@127.0.0.1:${port}/recovery`;
    const fd = openSync(resolve(archive), "r");
    try {
      command(
        [
          "exec",
          "-i",
          name,
          "pg_restore",
          "-U",
          "postgres",
          "-d",
          "recovery",
          "--exit-on-error",
          "--no-owner",
          "--no-acl",
        ],
        { stdio: [fd, "pipe", "pipe"], timeout: 300_000 },
      );
    } finally {
      closeSync(fd);
    }
    const migration = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../packages/db/scripts/migrate.mjs", import.meta.url),
        ),
        ...(adopt ? ["--adopt"] : []),
      ],
      {
        env: { ...process.env, DATABASE_URL: url },
        stdio: "pipe",
        timeout: 90_000,
      },
    );
    if (migration.error || migration.status !== 0)
      throw new Error("Restored migration verification failed");
    const client = connect(url);
    try {
      await client.connect();
      await checkRelease(client);
      const result =
        await client.query(`SELECT (SELECT count(*)::int FROM "user") AS users,
        (SELECT count(*)::int FROM recipe) AS recipes,
        (SELECT count(*)::int FROM recipe_import) AS imports`);
      await accept({ client, url });
      return {
        event: "recovery_rehearsal_completed",
        elapsedMs: Date.now() - started,
        counts: result.rows[0],
        adopted: adopt,
      };
    } finally {
      await client.end();
    }
  } finally {
    // Only this exact randomly generated container is ever removed.
    removeContainer();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (
      !process.argv[2] ||
      process.argv.slice(3).some((arg) => arg !== "--adopt")
    )
      throw new Error("Archive and optional --adopt required");
    process.stdout.write(
      `${JSON.stringify(await rehearseRecovery({ archive: process.argv[2], adopt: process.argv.includes("--adopt") }))}\n`,
    );
  } catch {
    process.stderr.write('{"event":"recovery_rehearsal_failed"}\n');
    process.exitCode = 1;
  }
}
