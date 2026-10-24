import { createFileRoute, redirect } from "@tanstack/react-router";

// Groups became households; keep old links working.
export const Route = createFileRoute("/_auth/groups")({
  beforeLoad: () => {
    throw redirect({ to: "/households", replace: true });
  },
});
