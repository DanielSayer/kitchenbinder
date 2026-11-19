import { TRPCError } from "@trpc/server";

const listCapacity = 1000;
const messages = {
  items:
    "Your list can hold up to 1,000 items. Clear some items before adding more.",
  trip: "This trip exceeds 1,000 ingredients. Choose fewer meals.",
};

/** The one cap on a household's shopping list. */
export function checkCapacity(
  count: number,
  reason: keyof typeof messages = "items",
) {
  if (count > listCapacity)
    throw new TRPCError({ code: "BAD_REQUEST", message: messages[reason] });
}
