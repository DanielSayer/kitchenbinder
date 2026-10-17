import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { createDb } from "./index";

const childMessage = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    pid: z.number().int().positive(),
    idle: z.number().int(),
  }),
  z.object({
    kind: z.literal("recovered"),
    disposal: z.object({
      removed: z.boolean(),
      total: z.number().int(),
      idle: z.number().int(),
    }),
    differentClient: z.boolean(),
    pid: z.number().int().positive(),
    answer: z.literal(42),
  }),
]);

it("survives an idle backend termination, discards the client and reconnects in a real process", async () => {
  expect(process.env.PREP_SHEET_TEST_DATABASE).toBe("isolated");
  const admin = createDb();
  const child = fork(
    fileURLToPath(new URL("./fixtures/pool-disconnect.ts", import.meta.url)),
    [],
    {
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: 10_000,
    },
  );
  let diagnostic = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (data: string) => {
    diagnostic += data;
  });
  try {
    const messages: z.infer<typeof childMessage>[] = [];
    const outcome = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
      child.on("message", (message) => {
        const parsed = childMessage.safeParse(message);
        if (!parsed.success) {
          reject(new Error("Invalid pool regression child message"));
          return;
        }
        messages.push(parsed.data);
        if (parsed.data.kind === "ready") {
          void admin.$client
            .query("SELECT pg_terminate_backend($1) AS terminated", [
              parsed.data.pid,
            ])
            .then((result) => {
              if (result.rows[0]?.terminated !== true) {
                reject(new Error("Test backend was not terminated"));
              }
            }, reject);
        }
      });
    });
    expect(outcome).toEqual({ code: 0, signal: null });
    expect(messages).toHaveLength(2);
    const ready = messages[0];
    const recovered = messages[1];
    expect(ready).toMatchObject({ kind: "ready", idle: 1 });
    expect(recovered).toMatchObject({
      kind: "recovered",
      disposal: { removed: true, total: 0, idle: 0 },
      differentClient: true,
      answer: 42,
    });
    expect(recovered?.pid).not.toBe(ready?.pid);
    expect(diagnostic.trim().split(/\r?\n/)).toEqual([
      JSON.stringify({ event: "database_pool_idle_error" }),
    ]);
  } finally {
    if (child.exitCode === null) child.kill();
    await admin.$client.end();
  }
});

it("reports a fixed secret-free diagnostic for every factory pool", async () => {
  const databases = [createDb(), createDb()];
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  const privateClient = {
    connectionString:
      "postgresql://private-user:private-password@private-host/db",
    toJSON() {
      throw new Error("Client diagnostics must never be serialised");
    },
  };
  const privateError = Object.assign(
    new Error("private query and parameters"),
    {
      code: "private code",
      detail: "private detail",
      client: privateClient,
      cause: new Error("private cause"),
      toJSON() {
        throw new Error("Error diagnostics must never be serialised");
      },
    },
  );
  try {
    for (const database of databases) {
      database.$client.emit("error", privateError, privateClient);
    }
    expect(diagnostic.mock.calls).toEqual([
      [JSON.stringify({ event: "database_pool_idle_error" })],
      [JSON.stringify({ event: "database_pool_idle_error" })],
    ]);
  } finally {
    diagnostic.mockRestore();
    await Promise.all(databases.map((database) => database.$client.end()));
  }
});

it("preserves foreground query rejection and transaction rollback", async () => {
  const database = createDb();
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(database.$client.query("SELECT 1 / 0")).rejects.toMatchObject({
      code: "22012",
    });
    await database.$client.query(
      "CREATE TEMPORARY TABLE pool_rollback_probe (value integer)",
    );
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO pool_rollback_probe VALUES (1)`);
        await tx.execute(sql`SELECT 1 / 0`);
      }),
    ).rejects.toMatchObject({ cause: { code: "22012" } });
    const result = await database.$client.query(
      "SELECT count(*)::integer AS count FROM pool_rollback_probe",
    );
    expect(result.rows).toEqual([{ count: 0 }]);
    expect(diagnostic).not.toHaveBeenCalled();
  } finally {
    diagnostic.mockRestore();
    await database.$client.end();
  }
});
