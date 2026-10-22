import { createFileRoute } from "@tanstack/react-router";
import { HouseholdPage } from "@/components/households/household-page";

export const Route = createFileRoute("/_auth/household")({
  ssr: false,
  component: HouseholdPage,
});
