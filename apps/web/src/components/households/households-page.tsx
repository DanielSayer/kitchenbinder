import { useState } from "react";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { LargeTitle, Sheet } from "@/components/pantry";
import { useHousehold } from "./household-context";
import { HouseholdManage } from "./household-manage";
import { HouseholdPicker } from "./household-picker";
import { JoinWithInvite, NewHousehold } from "./new-household";

/** /households: the Households sheet as a page, for desktop and deep links. */
export function HouseholdsPage() {
  const { households } = useHousehold();
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState<"new" | "join">();
  const manageId =
    households.data?.find((item) => item.id === selected)?.id ??
    households.data?.[0]?.id;
  return (
    <main id="main-content" className="page-width households-page">
      <LargeTitle sub="Each one is a shared binder. Plan and shopping list are per household.">
        Households
      </LargeTitle>
      <LoadingState
        pending={households.isPending}
        label="Loading households..."
      >
        <ErrorNotice
          message={households.error ? "Couldn't load households." : undefined}
          retry={() => void households.refetch()}
        />
        <div className="households-layout">
          <div className="households-column">
            <HouseholdPicker
              onManage={(item) => {
                setSelected(item.id);
                document
                  .getElementById("household-manage")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              onNew={() => setAdding("new")}
              onJoin={() => setAdding("join")}
            />
          </div>
          {manageId && (
            <section
              id="household-manage"
              className="households-column households-panel"
              aria-label="Manage household"
            >
              <HouseholdManage
                key={manageId}
                householdId={manageId}
                onGone={() => setSelected(undefined)}
              />
            </section>
          )}
        </div>
      </LoadingState>
      <Sheet
        open={adding !== undefined}
        onOpenChange={(open) => {
          if (!open) setAdding(undefined);
        }}
        title={adding === "join" ? "Join a household" : "New household"}
      >
        {adding === "join" ? (
          <JoinWithInvite onGo={() => setAdding(undefined)} />
        ) : (
          <NewHousehold
            onCreated={(id) => {
              setSelected(id);
              setAdding(undefined);
            }}
            onUpgrade={() => setAdding(undefined)}
          />
        )}
      </Sheet>
    </main>
  );
}
