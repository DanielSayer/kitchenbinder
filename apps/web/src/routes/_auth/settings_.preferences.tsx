import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { ErrorNotice, LoadingState } from "@/components/feedback";
import { usePreferences, weekDayNames } from "@/components/preferences";
import { SettingsPage } from "@/components/settings-page";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/settings_/preferences")({
  ssr: false,
  component: Preferences,
});

const weekStartChoices = [1, 2, 3, 4, 5, 6, 0] as const;

function Preferences() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const preferences = usePreferences();
  const name = useId();
  const queryKey = trpc.preferences.get.queryKey();
  const update = useMutation(
    trpc.preferences.update.mutationOptions({
      onMutate: async (next) => {
        await client.cancelQueries({ queryKey });
        const previous = client.getQueryData(queryKey);
        client.setQueryData(queryKey, next);
        return { previous };
      },
      onError: (_error, _next, context) => {
        client.setQueryData(queryKey, context?.previous);
        toast.error("Couldn't save your preference. Try again.");
      },
      onSettled: () => client.invalidateQueries({ queryKey }),
    }),
  );
  const weekStartsOn = preferences.data?.weekStartsOn;
  return (
    <SettingsPage title="Preferences">
      <LoadingState
        pending={preferences.isPending}
        label="Loading preferences..."
      >
        <ErrorNotice
          message={
            preferences.error ? "Couldn't load your preferences." : undefined
          }
          retry={() => void preferences.refetch()}
        />
        {weekStartsOn !== undefined && (
          <fieldset className="preference-group">
            <legend className="grouped-label">Week starts on</legend>
            <div className="pantry-list">
              {weekStartChoices.map((day) => (
                <label key={day} className="pantry-row preference-choice">
                  <input
                    type="radio"
                    className="pantry-visually-hidden"
                    name={name}
                    checked={weekStartsOn === day}
                    onChange={() => update.mutate({ weekStartsOn: day })}
                  />
                  <span className="pantry-row-text">
                    <b>{weekDayNames[day]}</b>
                  </span>
                  {weekStartsOn === day && (
                    <Check
                      size={20}
                      className="preference-check"
                      aria-hidden="true"
                    />
                  )}
                </label>
              ))}
            </div>
            <small className="preference-hint">
              Used by the meal planner and weekly shopping.
            </small>
          </fieldset>
        )}
      </LoadingState>
    </SettingsPage>
  );
}
