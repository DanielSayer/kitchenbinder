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
const unitSystemChoices = [
  { value: "metric", label: "Metric", hint: "Grams, kilos, millilitres" },
  { value: "imperial", label: "Imperial", hint: "Ounces, pounds, cups" },
] as const;
const measureStandardChoices = [
  { value: "au", label: "Australian", hint: "250 ml cup, 20 ml tablespoon" },
  { value: "us", label: "US", hint: "240 ml cup, 15 ml tablespoon" },
] as const;

function Choices<T extends string | number>({
  legend,
  hint,
  value,
  choices,
  onChange,
}: {
  legend: string;
  hint: string;
  value: T;
  choices: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <fieldset className="preference-group">
      <legend className="grouped-label">{legend}</legend>
      <div className="pantry-list">
        {choices.map((choice) => (
          <label key={choice.value} className="pantry-row preference-choice">
            <input
              type="radio"
              className="pantry-visually-hidden"
              name={name}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            <span className="pantry-row-text">
              <b>{choice.label}</b>
              {choice.hint && <small>{choice.hint}</small>}
            </span>
            {value === choice.value && (
              <Check
                size={20}
                className="preference-check"
                aria-hidden="true"
              />
            )}
          </label>
        ))}
      </div>
      <small className="preference-hint">{hint}</small>
    </fieldset>
  );
}

function Preferences() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const preferences = usePreferences();
  const queryKey = trpc.preferences.get.queryKey();
  const update = useMutation(
    trpc.preferences.update.mutationOptions({
      onMutate: async (next) => {
        await client.cancelQueries({ queryKey });
        const previous = client.getQueryData(queryKey);
        if (previous) client.setQueryData(queryKey, { ...previous, ...next });
        return { previous };
      },
      onError: (_error, _next, context) => {
        client.setQueryData(queryKey, context?.previous);
        toast.error("Couldn't save your preference. Try again.");
      },
      onSettled: () => client.invalidateQueries({ queryKey }),
    }),
  );
  const data = preferences.data;
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
        {data && (
          <>
            <Choices
              legend="Week starts on"
              hint="Used by the meal planner and weekly shopping."
              value={data.weekStartsOn}
              choices={weekStartChoices.map((day) => ({
                value: day,
                label: weekDayNames[day],
              }))}
              onChange={(weekStartsOn) => update.mutate({ weekStartsOn })}
            />
            <Choices
              legend="Units"
              hint="Recipes and shopping lists show amounts in these units."
              value={data.unitSystem}
              choices={unitSystemChoices}
              onChange={(unitSystem) => update.mutate({ unitSystem })}
            />
            <Choices
              legend="Cup and spoon sizes"
              hint="Used when converting cups and spoons in recipes."
              value={data.measureStandard}
              choices={measureStandardChoices}
              onChange={(measureStandard) => update.mutate({ measureStandard })}
            />
          </>
        )}
      </LoadingState>
    </SettingsPage>
  );
}
