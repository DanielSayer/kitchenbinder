import { z } from "zod";

const shoppingDraftSchema = z.object({
  text: z.string(),
  baseText: z.string().nullable(),
});
export type ShoppingDraft = z.infer<typeof shoppingDraftSchema>;

export function readShoppingDraft(key: string, text: string): ShoppingDraft {
  try {
    const value = sessionStorage.getItem(key) ?? localStorage.getItem(key);
    if (value === null) return { text, baseText: text };
    try {
      const parsed = shoppingDraftSchema.safeParse(JSON.parse(value));
      if (parsed.success) return parsed.data;
    } catch {
      /* Older drafts stored the input directly. */
    }
    // A legacy draft has no trustworthy baseline. Ask for review before saving.
    return { text: value, baseText: value === text ? text : null };
  } catch {
    return { text, baseText: text };
  }
}
export function groceryNeedsReview(draft: ShoppingDraft, saved: string) {
  return draft.text !== saved && draft.baseText !== saved;
}
