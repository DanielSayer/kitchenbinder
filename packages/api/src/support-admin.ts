import { db } from "@prep-sheet/db";
import { getSupportConfig } from "@prep-sheet/env/support";
import { z } from "zod";
import { completeAccountDeletion } from "./account-deletion";
import { listSupportQueue, resolveSupportReport } from "./support-operations";

const [command, reference, confirmation, ...extra] = process.argv.slice(2);
try {
  const { operator } = getSupportConfig(process.env);
  if (!operator)
    throw new Error(
      "Set SUPPORT_OPERATOR to the responsible queue owner before operating support.",
    );
  if (extra.length) throw new Error("Unexpected arguments.");
  if (command === "list") {
    if (reference !== undefined && reference !== "--offset")
      throw new Error("Use list [--offset <number>].");
    if (reference === undefined && confirmation !== undefined)
      throw new Error("Unexpected arguments.");
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .parse(reference === "--offset" ? confirmation : 0);
    process.stdout.write(
      `${JSON.stringify({ operator, ...(await listSupportQueue(offset)) }, null, 2)}\n`,
    );
  } else if (command === "complete-deletion" && confirmation === "--confirm") {
    await completeAccountDeletion(z.uuid().parse(reference));
    process.stdout.write(
      `${JSON.stringify({ event: "account_deleted", reference, operator })}\n`,
    );
  } else if (command === "resolve-report" && confirmation === "--confirm") {
    await resolveSupportReport(z.uuid().parse(reference));
    process.stdout.write(
      `${JSON.stringify({ event: "support_report_resolved", reference, operator })}\n`,
    );
  } else {
    throw new Error(
      "Usage: support-admin.ts list [--offset <number>] | resolve-report <report-id> --confirm | complete-deletion <request-id> --confirm",
    );
  }
} finally {
  await db.$client.end();
}
