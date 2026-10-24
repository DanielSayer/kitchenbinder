import { providerConfiguration } from "@prep-sheet/env/server";
import { publicProcedure, router } from "../index";
import { billingRouter } from "./billing";
import { collectionsRouter } from "./collections";
import { householdsRouter } from "./households";
import { plannerRouter } from "./planner";
import { recipesRouter } from "./recipes";
import { shoppingRouter } from "./shopping";
import { supportRouter } from "./support";
import { tagsRouter } from "./tags";

export const appRouter = router({
  signInProviders: publicProcedure.query(
    () => providerConfiguration.signInProviders,
  ),
  billing: billingRouter,
  recipes: recipesRouter,
  tags: tagsRouter,
  shopping: shoppingRouter,
  planner: plannerRouter,
  households: householdsRouter,
  collections: collectionsRouter,
  support: supportRouter,
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
});

export type AppRouter = typeof appRouter;
