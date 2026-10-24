import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { useHousehold } from "@/components/households/household-context";
import { Chip, ChipRow, isPantryTone } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";

/** Where a new recipe goes: always owned by the user, optionally placed. */
export type Destination = {
  collectionId: string | null;
  /** Non-personal households to share with. */
  householdIds: string[];
};

export const sameDestination = (a: Destination, b: Destination) =>
  a.collectionId === b.collectionId &&
  a.householdIds.length === b.householdIds.length &&
  a.householdIds.every((id, index) => b.householdIds[index] === id);

/** Default: no collection, shared with the selected household unless "Just me". */
export function useDefaultDestination(): Destination {
  const { householdId } = useHousehold();
  return { collectionId: null, householdIds: householdId ? [householdId] : [] };
}

export function useDestinationOptions() {
  const trpc = useTRPC();
  const { households } = useHousehold();
  const collections = useQuery(trpc.collections.list.queryOptions());
  return {
    households,
    collections,
    // Only my own collections are valid save targets.
    mine: collections.data?.filter((item) => item.isOwner) ?? [],
    shareable: households.data?.filter((item) => !item.personal) ?? [],
  };
}

/** Toast text after saving, e.g. "Saved to Weeknights · shared with Family". */
export function useSavedMessage() {
  const { mine, shareable } = useDestinationOptions();
  return (destination: Destination) => {
    const collection = mine.find(
      (item) => item.id === destination.collectionId,
    )?.name;
    const households = shareable
      .filter((item) => destination.householdIds.includes(item.id))
      .map((item) => item.name);
    return [
      `Saved to ${collection ?? "My recipes"}`,
      households.length ? `shared with ${households.join(" and ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
}

export function DestinationPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Destination;
  onChange: (value: Destination) => void;
  disabled?: boolean;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const { households, collections, mine, shareable } = useDestinationOptions();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const collectionLabel = useId();
  const shareLabel = useId();
  const nameId = useId();
  const create = useMutation(
    trpc.collections.create.mutationOptions({
      onSuccess: (created) => {
        setCreating(false);
        setName("");
        onChange({ ...value, collectionId: created.id });
        void client.invalidateQueries({
          queryKey: trpc.collections.list.queryKey(),
        });
      },
    }),
  );
  const selectedNames = shareable
    .filter((item) => value.householdIds.includes(item.id))
    .map((item) => item.name);

  function addCollection() {
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    create.mutate({ name: trimmed, description: "" });
  }

  function toggleHousehold(id: string) {
    const ids = value.householdIds.includes(id)
      ? value.householdIds.filter((item) => item !== id)
      : [...value.householdIds, id];
    // Keep household order stable so retries compare equal.
    onChange({
      ...value,
      householdIds: shareable
        .map((item) => item.id)
        .filter((item) => ids.includes(item)),
    });
  }

  return (
    <div className="ready-destination">
      <p className="ready-label" id={collectionLabel}>
        Add to collection <span>Optional</span>
      </p>
      <ChipRow
        role="group"
        aria-labelledby={collectionLabel}
        className="ready-chips"
      >
        {mine.map((item) => (
          <Chip
            key={item.id}
            pressed={value.collectionId === item.id}
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                collectionId: value.collectionId === item.id ? null : item.id,
              })
            }
          >
            {item.name}
          </Chip>
        ))}
        {!creating && (
          <Chip
            disabled={disabled}
            onClick={() => setCreating(true)}
            className="ready-new-chip"
          >
            <Plus size={16} aria-hidden="true" /> New collection
          </Chip>
        )}
      </ChipRow>
      {collections.isError && (
        <p className="ready-hint" role="alert">
          Couldn't load your collections.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void collections.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      {creating && (
        <div className="ready-new-collection">
          <label className="pantry-visually-hidden" htmlFor={nameId}>
            Collection name
          </label>
          <input
            id={nameId}
            // biome-ignore lint/a11y/noAutofocus: Opened by an explicit tap on "New collection".
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Collection name, e.g. Weeknights"
            disabled={create.isPending}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addCollection();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setCreating(false);
              }
            }}
          />
          <button
            type="button"
            className="button button-small"
            disabled={!name.trim() || create.isPending}
            onClick={addCollection}
          >
            Add
          </button>
          <button
            type="button"
            className="button button-small button-ghost"
            onClick={() => {
              setCreating(false);
              create.reset();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      {create.error && (
        <p className="ready-hint" role="alert">
          {create.error.message}
        </p>
      )}

      <p className="ready-label" id={shareLabel}>
        Share with <span>Optional</span>
      </p>
      {shareable.length > 0 ? (
        <ChipRow
          role="group"
          aria-labelledby={shareLabel}
          className="ready-chips"
        >
          {shareable.map((item) => (
            <Chip
              key={item.id}
              pressed={value.householdIds.includes(item.id)}
              dot={isPantryTone(item.color) ? item.color : "sage"}
              disabled={disabled}
              onClick={() => toggleHousehold(item.id)}
            >
              {item.name}
            </Chip>
          ))}
        </ChipRow>
      ) : null}
      {households.isError ? (
        <p className="ready-hint" role="alert">
          Couldn't load households.{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => void households.refetch()}
          >
            Retry
          </button>
        </p>
      ) : (
        <p className="ready-hint">
          {selectedNames.length
            ? `You keep it. ${selectedNames.join(" and ")} can cook it too.`
            : shareable.length
              ? "Only you. You can share it later."
              : "Only you. Make a household to share recipes."}
        </p>
      )}
    </div>
  );
}
