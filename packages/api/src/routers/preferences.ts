import { db } from "@prep-sheet/db";
import { userPreference } from "@prep-sheet/db/schema/preference";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

const defaults = { weekStartsOn: 1 };
const preferencesInput = z.object({
  weekStartsOn: z.number().int().min(0).max(6),
});

export const preferencesRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [saved] = await db
      .select({ weekStartsOn: userPreference.weekStartsOn })
      .from(userPreference)
      .where(eq(userPreference.userId, ctx.session.user.id));
    return saved ?? defaults;
  }),
  update: protectedProcedure
    .input(preferencesInput)
    .mutation(async ({ ctx, input }) => {
      await db
        .insert(userPreference)
        .values({ userId: ctx.session.user.id, ...input })
        .onConflictDoUpdate({ target: userPreference.userId, set: input });
      return input;
    }),
});
