import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authClient } from "@/lib/auth-client";
import { useTRPC } from "@/utils/trpc";
import { HouseholdDropdown } from "./household-dropdown";

// Selected household: scopes plan and shop, and is the share target on save.
// null = the personal "Just me" household.
const HouseholdContext = createContext<{
  householdId: string | null;
  selectHousehold: (id: string | null) => void;
}>({ householdId: null, selectHousehold: () => {} });

/** What the global Households sheet shows. */
export type HouseholdSheetView =
  | { name: "list" }
  | { name: "manage"; householdId: string }
  | { name: "new" }
  | { name: "join" };

const HouseholdSheetContext = createContext<{
  view: HouseholdSheetView | null;
  openHouseholds: (view?: HouseholdSheetView) => void;
  closeHouseholds: () => void;
}>({ view: null, openHouseholds: () => {}, closeHouseholds: () => {} });

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();
  const [view, setView] = useState<HouseholdSheetView | null>(null);
  const sheet = useMemo(
    () => ({
      view,
      openHouseholds: (next: HouseholdSheetView = { name: "list" }) =>
        setView(next),
      closeHouseholds: () => setView(null),
    }),
    [view],
  );
  return (
    <HouseholdSheetContext value={sheet}>
      <Selection key={session?.user.id ?? "guest"} userId={session?.user.id}>
        {children}
      </Selection>
    </HouseholdSheetContext>
  );
}

/** Open/close the global Households sheet (chip, You screen, menus). */
export function useHouseholdSheet() {
  return useContext(HouseholdSheetContext);
}

function Selection({
  children,
  userId,
}: {
  children: ReactNode;
  userId?: string;
}) {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    try {
      const saved = localStorage.getItem(`prep-sheet-household:${userId}`);
      if (saved && /^[a-f0-9-]{36}$/i.test(saved)) setHouseholdId(saved);
    } catch {
      /* Browsing with storage disabled still supports household switching. */
    }
  }, [userId]);
  function selectHousehold(id: string | null) {
    setHouseholdId(id);
    if (!userId) return;
    try {
      if (id) localStorage.setItem(`prep-sheet-household:${userId}`, id);
      else localStorage.removeItem(`prep-sheet-household:${userId}`);
    } catch {
      /* The selection remains available for this page session. */
    }
  }
  return (
    <HouseholdContext value={{ householdId, selectHousehold }}>
      {children}
    </HouseholdContext>
  );
}

export function useHousehold() {
  const selection = useContext(HouseholdContext);
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const households = useQuery(
    trpc.households.list.queryOptions(undefined, {
      enabled: !!session,
      refetchOnWindowFocus: "always",
    }),
  );
  const selected = households.data?.find(
    (item) => item.id === selection.householdId,
  );
  const available = !selection.householdId || !!selected;
  const personal = households.data?.find((item) => item.personal);
  return {
    // A personal household id behaves like "Just me".
    householdId: selected?.personal ? null : selection.householdId,
    selectHousehold: selection.selectHousehold,
    households,
    name: selection.householdId
      ? (selected?.name ?? "Unavailable household")
      : "Just me",
    color: selected?.color ?? personal?.color ?? "sage",
    /** The selected household row (personal row when "Just me"). */
    current: selection.householdId ? selected : personal,
    // The global chip is hidden when "Just me" is the only household.
    multiple: (households.data?.length ?? 0) > 1,
    available,
  };
}

// Planner/shopping scope for tRPC inputs; undefined = the personal household.
export function useHouseholdScope() {
  return useContext(HouseholdContext).householdId ?? undefined;
}

export function HouseholdSelect({
  disabled = false,
  label = "Household",
}: {
  disabled?: boolean;
  label?: string;
}) {
  const { householdId, selectHousehold, households, available } =
    useHousehold();
  return (
    <>
      <HouseholdDropdown
        disabled={disabled}
        label={label}
        manageHouseholds
        value={householdId ?? ""}
        onValueChange={(value) => selectHousehold(value || null)}
        options={[
          { label: "Just me", value: "" },
          ...(!available && householdId
            ? [{ label: "Unavailable household", value: householdId }]
            : []),
          ...(households.data
            ?.filter((item) => !item.personal)
            .map((item) => ({ label: item.name, value: item.id })) ?? []),
        ]}
      />
      {households.error && (
        <span role="alert">
          Couldn't load households.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void households.refetch()}
          >
            Retry
          </button>
        </span>
      )}
    </>
  );
}
