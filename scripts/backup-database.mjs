import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ownContainer } from "./disposable-container.mjs";

export function dockerDatabaseUrl(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("PostgreSQL URL required");
  if (
    process.platform !== "linux" &&
    ["127.0.0.1", "localhost"].includes(url.hostname)
  )
    url.hostname = "host.docker.internal";
  return url.href;
}

// No implicit runtime DATABASE_URL, and no restore operation. The caller chooses
// the read-only backup source explicitly. Docker arguments never include its URL.
export function backupDatabase({ source, archive }) {
  const database = new URL(dockerDatabaseUrl(source));
  const environment = {
    PGHOST: database.hostname,
    PGPORT: database.port || "5432",
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
  };
  const mounts = [];
  const options = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    channel_binding: "PGCHANNELBINDING",
    connect_timeout: "PGCONNECT_TIMEOUT",
  };
  for (const [key, value] of database.searchParams) {
    if (!Object.hasOwn(options, key))
      throw new Error("Unsupported backup connection option");
    if (["sslrootcert", "sslcert", "sslkey"].includes(key)) {
      const inside = `/tls/${key}`;
      mounts.push("-v", `${resolve(value)}:${inside}:ro`);
      environment[options[key]] = inside;
    } else environment[options[key]] = value;
  }
  const destination = resolve(archive);
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.partial`;
  const name = `prep-sheet-backup-${randomUUID()}`;
  const removeContainer = ownContainer(name);
  const fd = openSync(temporary, "wx", 0o600);
  try {
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--label",
        "prep-sheet.disposable=backup",
        ...(process.platform === "linux" ? ["--network=host"] : []),
        ...Object.keys(environment).flatMap((key) => ["-e", key]),
        ...mounts,
        "postgres:18",
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--lock-wait-timeout=10s",
      ],
      {
        env: { ...process.env, ...environment },
        encoding: "utf8",
        timeout: 300_000,
        stdio: ["ignore", fd, "pipe"],
      },
    );
    if (result.error || result.status !== 0 || statSync(temporary).size === 0) {
      throw new Error("Backup failed");
    }
    // Never overwrite a known-good archive, including after a failed scheduled run.
    if (statExists(destination)) throw new Error("Archive already exists");
    fsyncSync(fd);
    linkSync(temporary, destination);
    return destination;
  } finally {
    closeSync(fd);
    removeContainer();
    rmSync(temporary, { force: true });
  }
}
function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!process.env.BACKUP_SOURCE_DATABASE_URL || !process.argv[2])
      throw new Error("Explicit source and archive required");
    const archive =
      process.argv[2] === "--directory"
        ? resolve(
            process.argv[3],
            `prep-sheet-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.dump`,
          )
        : process.argv[2];
    backupDatabase({
      source: process.env.BACKUP_SOURCE_DATABASE_URL,
      archive,
    });
    process.stdout.write('{"event":"database_backup_completed"}\n');
  } catch {
    process.stderr.write('{"event":"database_backup_failed"}\n');
    process.exitCode = 1;
  }
}
