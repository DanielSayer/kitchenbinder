import { createFileRoute } from "@tanstack/react-router";
import { HouseholdsPage } from "@/components/households/households-page";

export const Route = createFileRoute("/_auth/households")({
  component: HouseholdsPage,
});
