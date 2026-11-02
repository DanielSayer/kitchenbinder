import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/utils/trpc";

export const weekDayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function usePreferences() {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.preferences.get.queryOptions(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** 0 = Sunday ... 6 = Saturday. Monday until preferences load. */
export function useWeekStartsOn() {
  return usePreferences().data?.weekStartsOn ?? 1;
}

/** Metric or imperial, and AU or US cup sizes. Metric AU until loaded. */
export function useMeasurePreferences() {
  const data = usePreferences().data;
  return {
    unitSystem: data?.unitSystem ?? "metric",
    measureStandard: data?.measureStandard ?? "au",
  } as const;
}
