import { Link, useRouterState } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { initialsOf, isYouPath, mainDestinations } from "./destinations";

/** Mobile bottom tab bar: Add, Recipes, Shop, Plan, You. Hidden on desktop. */
export function TabBar() {
  const { data: session, isPending, error } = authClient.useSession();
  const youActive = useRouterState({
    select: (state) => isYouPath(state.location.pathname),
  });
  // Signed-out screens (welcome, landing) have no tab bar, as in the design.
  // A failed session fetch isn't "signed out"; keep nav so it doesn't vanish.
  if (!session && !isPending && !error) return null;
  return (
    <nav className="tab-bar" aria-label="Main">
      {mainDestinations.map(({ to, label, icon: Icon, exact }) => (
        <Link
          key={to}
          to={to}
          className="tab"
          activeOptions={{ exact }}
          activeProps={{ "aria-current": "page" }}
        >
          <span className="tab-icon">
            <Icon size={22} strokeWidth={1.9} aria-hidden="true" />
          </span>
          {label}
        </Link>
      ))}
      <Link
        to={session ? "/settings" : "/login"}
        className="tab"
        aria-current={youActive ? "page" : undefined}
        aria-busy={isPending || undefined}
      >
        <span className="tab-icon">
          {session ? (
            <span className="tab-avatar" aria-hidden="true">
              {initialsOf(session.user.name)}
            </span>
          ) : (
            <UserRound size={22} strokeWidth={1.9} aria-hidden="true" />
          )}
        </span>
        You
      </Link>
    </nav>
  );
}
