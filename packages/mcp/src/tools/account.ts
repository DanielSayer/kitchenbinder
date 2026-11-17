import { z } from "zod";
import { behaviour, defineTool } from "./tool";

export const getAccountOverview = defineTool({
  name: "get_account_overview",
  description:
    "Get the signed-in person's name, current plan and household IDs. Use this first to choose a shared household. Personal household is the default for shopping, planning and recipe creation.",
  input: z.object({}),
  annotations: behaviour.read,
  async run(_input, { user, api }) {
    const households = (await api.households.list()).map(
      ({ id, name, personal }) => ({ id, name, personal }),
    );
    // Tools only run for Pro accounts, so the plan is always Pro here.
    return {
      summary: `Connected as ${user.name} on Pro. ${households.length} household(s) available.`,
      data: { name: user.name, plan: "pro", households },
    };
  },
});
