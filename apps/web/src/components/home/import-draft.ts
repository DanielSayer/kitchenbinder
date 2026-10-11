import { z } from "zod";

const pendingImportSchema = z.object({
  id: z.uuid(),
  input: z.string().trim().min(3).max(20000),
  groupId: z.uuid().nullable(),
});
export type PendingImport = z.infer<typeof pendingImportSchema>;
export const importDraftKey = (userId: string) =>
  `prep-sheet-import:v1:${userId}`;

export function readPendingImport(key: string): PendingImport | null {
  try {
    const parsed = pendingImportSchema.safeParse(
      JSON.parse(sessionStorage.getItem(key) ?? "null"),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writePendingImport(key: string, value: PendingImport | null) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const importQueueSchema = z
  .array(pendingImportSchema)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
  );

export function readImportQueue(key: string): PendingImport[] {
  try {
    const stored = sessionStorage.getItem(`${key}:queue`);
    if (stored !== null) {
      const parsed = importQueueSchema.safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data : [];
    }
    const legacy = readPendingImport(key);
    return legacy ? [legacy] : [];
  } catch {
    return [];
  }
}

export function writeImportQueue(key: string, items: PendingImport[]) {
  try {
    // Write the full queue before retiring the old single-request record.
    sessionStorage.setItem(`${key}:queue`, JSON.stringify(items));
    sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
