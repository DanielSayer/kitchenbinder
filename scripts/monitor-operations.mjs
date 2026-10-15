import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createOperations } from "./operations.mjs";

const destinationSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" && url.hostname === "127.0.0.1")
  );
});

// Payloads contain fixed issue codes, no records, URLs, errors or credentials.
export async function deliverAlert({ destination, token, issues, recovered }) {
  const response = await fetch(destinationSchema.parse(destination), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      event: recovered ? "operations_recovered" : "operations_alert",
      timestamp: new Date().toISOString(),
      issues,
    }),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Alert rejected");
}

export function createNotifier({ destination, token, repeatMs = 3_600_000 }) {
  let previous = "[]";
  let deliveredAt = 0;
  return async (issues, now = Date.now()) => {
    const state = JSON.stringify([...issues].sort());
    if (
      state === previous &&
      (issues.length === 0 || now - deliveredAt < repeatMs)
    )
      return;
    // Commit notification state only after acceptance, so failed deliveries retry.
    await deliverAlert({
      destination,
      token,
      issues,
      recovered: issues.length === 0,
    });
    previous = state;
    deliveredAt = now;
  };
}

export async function monitor() {
  const destination = destinationSchema.parse(
    process.env.OPS_ALERT_WEBHOOK_URL,
  );
  const web = z.url().parse(process.env.OPS_WEB_URL);
  const operations = createOperations();
  const notify = createNotifier({
    destination,
    token: process.env.OPS_ALERT_TOKEN,
  });
  const stop = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => stop.abort());
  try {
    while (!stop.signal.aborted) {
      const snapshot = await operations.snapshot();
      const issues = [...snapshot.issues];
      try {
        const response = await fetch(web, {
          redirect: "error",
          signal: AbortSignal.timeout(4000),
        });
        await response.body?.cancel();
        if (!response.ok) issues.push("web_unavailable");
      } catch {
        issues.push("web_unavailable");
      }
      try {
        await notify(issues);
      } catch {
        process.stderr.write('{"event":"operations_alert_delivery_failed"}\n');
      }
      try {
        await setTimeout(30_000, undefined, { signal: stop.signal });
      } catch (error) {
        if (!stop.signal.aborted) throw error;
      }
    }
  } finally {
    await operations.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await monitor();
  } catch {
    process.stderr.write('{"event":"operations_monitor_failed"}\n');
    process.exitCode = 1;
  }
}
