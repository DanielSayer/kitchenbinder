import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "packages/db/docker-compose.test.yml");
const project = `prep-sheet-test-${randomUUID().slice(0, 12)}`;
const runtimeDirectory = resolve(root, "tmp", project);
if (dirname(runtimeDirectory) !== resolve(root, "tmp")) {
  throw new Error(
    "Test runtime directory must stay inside the workspace tmp directory",
  );
}
const composeArgs = ["compose", "-p", project, "-f", composeFile];
const dbDir = join(root, "packages/db");
const vitest = join(root, "node_modules/vitest/vitest.mjs");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function output(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

function runVitest(args, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [vitest, "run", ...args], {
      cwd: root,
      env,
      stdio: "inherit",
    });
    const forward = (signal) => child.kill(signal);
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolveRun(signal ? 1 : (code ?? 1));
    });
  });
}

if (!existsSync(vitest)) {
  throw new Error(
    "Install workspace dependencies with pnpm install before running tests.",
  );
}

const webEnvPath = join(root, "apps/web/.env");
const webEnv = existsSync(webEnvPath)
  ? parse(readFileSync(webEnvPath, "utf8"))
  : {};
let exitCode = 1;

try {
  run("docker", [...composeArgs, "up", "-d", "--wait"]);
  const binding = output("docker", [
    ...composeArgs,
    "port",
    "postgres",
    "5432",
  ]);
  const port = Number(binding.match(/:(\d+)$/)?.[1]);
  if (!Number.isInteger(port) || port < 1) {
    throw new Error(`Cannot determine isolated PostgreSQL port: ${binding}`);
  }
  const devPort = Number(
    new URL(
      process.env.DATABASE_URL ??
        webEnv.DATABASE_URL ??
        "postgresql://localhost:5432/",
    ).port || 5432,
  );
  if (port === devPort) {
    throw new Error(
      `Test PostgreSQL was assigned the development port ${port}`,
    );
  }
  const testUrl = `postgresql://postgres:test_password@127.0.0.1:${port}/prep_sheet_test`;
  const env = {
    ...webEnv,
    ...process.env,
    DATABASE_URL: testUrl,
    BETTER_AUTH_SECRET: "local-test-secret-only-not-for-production-12345",
    BETTER_AUTH_URL: "http://localhost:3001",
    NODE_ENV: "test",
    PREP_SHEET_TEST_DATABASE: "isolated",
    WORKER_WAKE_PATH: join(runtimeDirectory, "wake", "request"),
    WORKER_HEARTBEAT_PATH: join(runtimeDirectory, "operations", "worker.json"),
    AI_ENABLED: "true",
    BILLING_MODE: "disabled",
    POLAR_ACCESS_TOKEN: "",
    POLAR_PRO_PRODUCT_ID: "",
    POLAR_WEBHOOK_SECRET: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    DISCORD_CLIENT_ID: "",
    DISCORD_CLIENT_SECRET: "",
  };
  if (env.LIVE_AI_TEST !== "1") {
    // Integration tests mock generation, but import admission checks for a key.
    env.OPENAI_API_KEY = "local-test-placeholder";
  }
  console.info(`Test PostgreSQL: ${project} on 127.0.0.1:${port}`);
  run(process.execPath, [join(dbDir, "scripts/migrate.mjs")], { env });
  const args = process.argv.slice(2);
  exitCode = await runVitest(args[0] === "--" ? args.slice(1) : args, env);
} finally {
  // Also clean up a partially created project when `up --wait` fails.
  try {
    run("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"]);
  } catch (error) {
    console.error(
      `Could not remove test PostgreSQL project ${project}:`,
      error,
    );
    exitCode = 1;
  }
  rmSync(runtimeDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
