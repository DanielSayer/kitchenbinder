import { getSupportConfig } from "@prep-sheet/env/support";
import { createServerFn } from "@tanstack/react-start";

export const getSupportContact = createServerFn({ method: "GET" }).handler(
  () => ({ email: getSupportConfig(process.env).email }),
);
