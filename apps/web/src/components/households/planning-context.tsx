import type { AppRouter } from "@prep-sheet/api/routers/index";
import {
  type PlanningScope,
  personalScope,
  planningKey,
  planningScopeSchema,
} from "@prep-sheet/db/planning-scope";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { ErrorNotice, LoadingState } from "../feedback";

type Household = inferRouterOutputs<AppRouter>["households"]["current"];
type PlanningContextValue = {
  scope: PlanningScope;
  scopeKey: string;
  selectScope: (scope: PlanningScope) => void;
  household: Household;
  ready: boolean;
  available: boolean;
  error: string | undefined;
  retry: () => void;
};
const PlanningContext = createContext<PlanningContextValue | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  return (
    <Selection key={session?.user.id ?? "guest"} userId={session?.user.id}>
      {children}
    </Selection>
  );
}
function Selection({
  userId,
  children,
}: {
  userId?: string;
  children: ReactNode;
}) {
  const trpc = useTRPC();
  const current = useQuery(
    trpc.households.current.queryOptions(undefined, {
      enabled: !!userId,
      refetchOnWindowFocus: "always",
      refetchInterval: userId ? 15000 : false,
    }),
  );
  const [selection, setSelection] = useState<PlanningScope | null>(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (userId) {
      try {
        const stored = planningScopeSchema.safeParse(
          JSON.parse(
            localStorage.getItem(`kitchenbinder-planning:${userId}`) ?? "null",
          ),
        );
        if (stored.success) setSelection(stored.data);
      } catch {
        /* Selection still works without browser storage. */
      }
    }
    setRestored(true);
  }, [userId]);
  function selectScope(scope: PlanningScope) {
    setSelection(scope);
    if (userId) {
      try {
        localStorage.setItem(
          `kitchenbinder-planning:${userId}`,
          JSON.stringify(scope),
        );
      } catch {
        /* Keep the current selection in memory. */
      }
    }
  }
  const household = current.data ?? null;
  useEffect(() => {
    if (restored && current.isSuccess && selection === null)
      setSelection(
        household
          ? { kind: "household", householdId: household.id }
          : personalScope,
      );
  }, [restored, current.isSuccess, household, selection]);
  const scope =
    selection ??
    (household
      ? ({
          kind: "household",
          householdId: household.id,
        } satisfies PlanningScope)
      : personalScope);
  return (
    <PlanningContext
      value={{
        scope,
        scopeKey: planningKey(scope),
        selectScope,
        household,
        ready: restored && (!userId || current.data !== undefined),
        available:
          scope.kind === "personal" || household?.id === scope.householdId,
        error: current.error?.message,
        retry: () => {
          void current.refetch();
        },
      }}
    >
      {children}
    </PlanningContext>
  );
}
export function usePlanningScope() {
  const context = useContext(PlanningContext);
  if (!context) throw new Error("Planning requires HouseholdProvider.");
  return context;
}
export function planningRefresh(scope: PlanningScope) {
  return {
    refetchInterval: scope.kind === "household" ? 5000 : false,
    refetchOnWindowFocus: "always",
  } as const;
}

// Remount open forms when switching planners. Their drafts remain in their own scope.
export function PlanningWorkspace({ children }: { children: ReactNode }) {
  const planning = usePlanningScope();
  if (!planning.ready)
    return (
      <main id="main-content" className="page-width">
        <LoadingState
          pending={!planning.error}
          label="Loading your planners..."
        >
          <ErrorNotice message={planning.error} retry={planning.retry} />
        </LoadingState>
      </main>
    );
  if (!planning.available)
    return (
      <main id="main-content" className="page-width household-page">
        <h1>Household unavailable</h1>
        <p>
          You no longer have access to this household. Your personal planner,
          shopping list and any stored drafts are still available.
        </p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => planning.selectScope(personalScope)}
        >
          Switch to Personal
        </button>
      </main>
    );
  return <Fragment key={planning.scopeKey}>{children}</Fragment>;
}
