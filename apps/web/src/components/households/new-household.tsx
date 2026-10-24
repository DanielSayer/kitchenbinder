import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import type { PantryTone } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { useHousehold } from "./household-context";
import { ColourPicker, inviteTokenFrom } from "./household-ui";

/** Create a household (Pro). Free accounts see the upgrade path instead. */
export function NewHousehold({
  onCreated,
  onUpgrade,
}: {
  onCreated?: (id: string) => void;
  /** Called before navigating to the plan, e.g. to close a sheet. */
  onUpgrade?: () => void;
}) {
  const trpc = useTRPC();
  const client = useQueryClient();
  const { selectHousehold } = useHousehold();
  const status = useQuery(trpc.billing.status.queryOptions());
  const [name, setName] = useState("");
  const [color, setColor] = useState<PantryTone>("tomato");
  const create = useMutation(
    trpc.households.create.mutationOptions({
      onSuccess: async (created) => {
        await client.invalidateQueries({ queryKey: trpc.households.pathKey() });
        selectHousehold(created.id);
        setName("");
        toast.success(`${created.name} is ready. Invite people next.`);
        onCreated?.(created.id);
      },
    }),
  );

  return (
    <LoadingState pending={status.isPending} label="Checking your plan...">
      {status.data && !status.data.createHousehold ? (
        <div className="household-upsell">
          <p className="household-upsell-eyebrow">Pro</p>
          <h3>Share a binder with your people</h3>
          <p>
            Creating a household and inviting others is part of Pro. Joining a
            household someone else made is free.
          </p>
          <Link
            to="/settings"
            search={{ billing: "1" }}
            className="button button-primary button-block"
            onClick={onUpgrade}
          >
            See Pro
          </Link>
        </div>
      ) : (
        <form
          className="household-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) create.mutate({ name: name.trim(), color });
          }}
        >
          <label className="household-field">
            <span>Name</span>
            <input
              required
              maxLength={80}
              autoComplete="off"
              placeholder="e.g. Family, Flatmates"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <ColourPicker value={color} onChange={setColor} />
          <p className="household-hint">
            Recipes you share, the meal plan and the shopping list are per
            household. Your own recipes stay yours.
          </p>
          <ErrorNotice message={create.error?.message} />
          <button
            type="submit"
            className="button button-primary button-block"
            disabled={create.isPending || !name.trim()}
          >
            {create.isPending ? "Creating..." : "Create household"}
          </button>
        </form>
      )}
      <ErrorNotice
        message={status.error ? "Couldn't check your plan." : undefined}
        retry={() => void status.refetch()}
      />
    </LoadingState>
  );
}

/** Paste an invite link (or code) and continue on the join screen. */
export function JoinWithInvite({ onGo }: { onGo?: () => void }) {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="household-form"
      onSubmit={(event) => {
        event.preventDefault();
        const token = inviteTokenFrom(value);
        if (!token) {
          setError("That doesn't look like an invite link. Paste it again.");
          return;
        }
        onGo?.();
        void navigate({ to: "/join", hash: token });
      }}
    >
      <label className="household-field">
        <span>Invite link</span>
        <input
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the link you were sent"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
        />
      </label>
      <p className="household-hint">
        Joining is free. You'll see the household before you join.
      </p>
      <ErrorNotice message={error} />
      <button
        type="submit"
        className="button button-primary button-block"
        disabled={!value.trim()}
      >
        Continue
      </button>
    </form>
  );
}
