import { z } from "zod";

// Android share sheets send a URL in `url`, or bury it inside `text`.
export type SharedPayload = { title?: string; text?: string; url?: string };

const pendingKey = "kitchenbinder:share:pending";
// An abandoned sign-in should not import a stale share much later.
const pendingTtl = 60 * 60 * 1000;
const pendingSchema = z.object({
  input: z.string().trim().min(3).max(20000),
  savedAt: z.number(),
});

function webUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function firstUrl(value?: string) {
  for (const match of value?.match(/https?:\/\/[^\s<>"]+/gi) ?? []) {
    const url = webUrl(match.replace(/[.,!?;:)\]]+$/, ""));
    if (url) return url;
  }
  return null;
}

/** The composer input for a share: its link, else its text. */
export function sharedRecipeInput({ title, text, url }: SharedPayload) {
  const link =
    (url?.trim() && webUrl(url.trim())) || firstUrl(text) || firstUrl(title);
  if (link) return link;
  const fallback = text?.trim() || title?.trim() || "";
  return fallback.length >= 3 ? fallback.slice(0, 20000) : null;
}

export function readPendingShare(now = Date.now()) {
  try {
    const parsed = pendingSchema.safeParse(
      JSON.parse(localStorage.getItem(pendingKey) ?? "null"),
    );
    if (parsed.success && now - parsed.data.savedAt < pendingTtl)
      return parsed.data.input;
    localStorage.removeItem(pendingKey);
  } catch {
    /* No pending share without storage. */
  }
  return null;
}

// localStorage, not sessionStorage: sign-in can return in a new browsing context.
export function writePendingShare(input: string | null, now = Date.now()) {
  try {
    if (input)
      localStorage.setItem(pendingKey, JSON.stringify({ input, savedAt: now }));
    else localStorage.removeItem(pendingKey);
    return true;
  } catch {
    return false;
  }
}
