import { db } from "@prep-sheet/db";
import { userPreference } from "@prep-sheet/db/schema/preference";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

const preferencesSchema = z.object({
  weekStartsOn: z.number().int().min(0).max(6),
  unitSystem: z.enum(["metric", "imperial"]),
  measureStandard: z.enum(["au", "us"]),
});
type Preferences = z.infer<typeof preferencesSchema>;

const defaults: Preferences = {
  weekStartsOn: 1,
  unitSystem: "metric",
  measureStandard: "au",
};
const columns = {
  weekStartsOn: userPreference.weekStartsOn,
  unitSystem: userPreference.unitSystem,
  measureStandard: userPreference.measureStandard,
};

async function read(userId: string) {
  const [saved] = await db
    .select(columns)
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return saved ? preferencesSchema.parse(saved) : defaults;
}

export const preferencesRouter = router({
  get: protectedProcedure.query(({ ctx }) => read(ctx.session.user.id)),
  update: protectedProcedure
    .input(preferencesSchema.partial())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (Object.keys(input).length)
        await db
          .insert(userPreference)
          .values({ userId, ...input })
          .onConflictDoUpdate({ target: userPreference.userId, set: input });
      return read(userId);
    }),
});
