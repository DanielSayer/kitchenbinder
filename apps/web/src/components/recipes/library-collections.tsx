import { Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import {
  type CollectionSummary,
  collectionTone,
  householdTone,
} from "@/components/collections/use-collections";
import { HouseholdSwitch } from "@/components/households/household-switch";
import { BinderTabs, toneColor } from "@/components/pantry";

const longPressMs = 500;

export function CollectionMeta({
  collection,
}: {
  collection?: CollectionSummary;
}) {
  if (!collection)
    return (
      <span className="library-meta">
        Yours and shared with you
        <Link to="/recipes/imports" className="library-meta-link">
          <History size={14} aria-hidden="true" /> Recent imports
        </Link>
      </span>
    );
  const shared = collection.sharedWith;
  return (
    <span className="library-meta">
      {shared.length ? (
        <span className="library-dots" aria-hidden="true">
          {shared.slice(0, 4).map((household) => (
            <i
              key={household.id}
              style={
                {
                  "--hc": toneColor(householdTone(household.color)),
                } as CSSProperties
              }
            />
          ))}
        </span>
      ) : null}
      {collection.isOwner
        ? shared.length
          ? `Shared with ${shared.map((item) => item.name).join(", ")}`
          : "Just you"
        : `From ${collection.owner.name}`}
      {collection.description ? ` · ${collection.description}` : ""}
    </span>
  );
}

export function LibraryBinder({
  collections,
  collectionId,
  onManage,
  onSelect,
  onCreate,
}: {
  collections: CollectionSummary[];
  collectionId?: string;
  onManage: (collection: CollectionSummary) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  // Long-press (or right-click) a collection tab to manage it.
  const pressTimer = useRef<number | undefined>(undefined);
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const tabCollection = (target: EventTarget, root: HTMLElement) => {
    const tab = (target as Element).closest?.('[role="tab"]');
    if (!tab) return undefined;
    const index = [...root.querySelectorAll('[role="tab"]')].indexOf(tab);
    return index > 0 ? collections[index - 1] : undefined;
  };
  const cancelPress = () => {
    window.clearTimeout(pressTimer.current);
    pressStart.current = null;
  };
  const onBinderPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const collection = tabCollection(event.target, event.currentTarget);
    if (!collection) return;
    pressStart.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressStart.current = null;
      onManage(collection);
    }, longPressMs);
  };
  const onBinderPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pressStart.current;
    if (
      start &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
    )
      cancelPress();
  };
  useEffect(() => () => window.clearTimeout(pressTimer.current), []);

  const tabs = [
    { id: "all", label: "All" },
    ...collections.map((item) => ({
      id: item.id,
      label: item.name,
      tone: collectionTone(item),
    })),
  ];
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: long-press shortcut; the ••• button is the accessible path */}
      <div
        className="library-binder"
        onPointerDown={onBinderPointerDown}
        onPointerMove={onBinderPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onContextMenu={(event) => {
          const collection = tabCollection(event.target, event.currentTarget);
          if (!collection) return;
          event.preventDefault();
          cancelPress();
          onManage(collection);
        }}
      >
        <BinderTabs
          tabs={tabs}
          value={collectionId ?? "all"}
          onChange={onSelect}
          label="Collections"
          onAdd={onCreate}
          addLabel="New collection"
          panelId="library-panel"
        />
        <HouseholdSwitch className="library-household" />
      </div>
    </>
  );
}
