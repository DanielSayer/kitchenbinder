import type { AppRouter } from "@prep-sheet/api/routers/index";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { History, Plus, Shuffle, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { RecipeCover } from "@/components/pantry";
import { useTRPC } from "@/utils/trpc";
import { localDate } from "./dates";

type Row = inferRouterOutputs<AppRouter>["planner"]["suggestions"][number];
type Suggestion = Row["items"][number];

const rowSize = 6;
const headings: Record<Row["key"], { label: string; icon: typeof Star }> = {
  favourites: { label: "Favourites you haven't had lately", icon: Star },
  forgotten: { label: "Forgotten", icon: History },
  untried: { label: "Never tried", icon: Sparkles },
};

export function ago(from: string, today: string) {
  const days = Math.round((Date.parse(today) - Date.parse(from)) / 86400000);
  if (days < 14) return days === 1 ? "yesterday" : `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} wks ago`;
  const months = Math.round(days / 30);
  return months < 24
    ? `${months} mths ago`
    : `${Math.round(days / 365)} yrs ago`;
}

/** Why the card is shown, e.g. "★4.5 · last had 6 wks ago". */
export function reason(item: Suggestion, today: string) {
  const rating =
    item.rating !== null
      ? `★${Math.round(item.rating * 10) / 10}`
      : item.favourite
        ? "Favourite"
        : null;
  const had = item.lastHad
    ? `last had ${ago(item.lastHad, today)}`
    : "never had";
  return rating
    ? `${rating} · ${had}`
    : had.charAt(0).toUpperCase() + had.slice(1);
}

export function SuggestionRows({
  householdId,
  weekStart,
  collectionId,
  radioName,
  selectedId,
  onPick,
}: {
  householdId?: string;
  weekStart: string;
  collectionId?: string;
  radioName: string;
  selectedId?: string;
  onPick: (id: string) => void;
}) {
  const trpc = useTRPC();
  const [shuffle, setShuffle] = useState(0);
  const today = localDate();
  const suggestions = useQuery(
    trpc.planner.suggestions.queryOptions({
      householdId,
      weekStart,
      today,
      collectionId,
      shuffle,
    }),
  );
  // Optional help: errors and loading leave the normal picker in charge.
  if (!suggestions.data) return null;
  return (
    <section className="suggest" aria-label="Suggestions">
      <div className="suggest-head">
        <h3>Need ideas?</h3>
        <button
          type="button"
          className="suggest-shuffle"
          onClick={() => setShuffle((value) => value + 1)}
          disabled={suggestions.isFetching}
        >
          <Shuffle size={16} aria-hidden="true" /> Shuffle
        </button>
      </div>
      {suggestions.data.map((row) => {
        const { label, icon: Icon } = headings[row.key];
        return (
          <div className="suggest-row" key={row.key}>
            <h4>
              <Icon size={15} aria-hidden="true" /> {label}
            </h4>
            <div className="suggest-cards" role="radiogroup" aria-label={label}>
              {row.items.map((item) => (
                <label className="suggest-card" key={item.id}>
                  <input
                    type="radio"
                    className="pick-input"
                    // Own group: the same recipe may also be listed below.
                    name={`${radioName}-suggested`}
                    checked={selectedId === item.id}
                    onChange={() => onPick(item.id)}
                  />
                  <RecipeCover
                    id={item.id}
                    title={item.title}
                    photo={item.photo}
                    size="thumb"
                  />
                  <span className="pick-text">
                    <b className="pick-title">{item.title}</b>
                    <small>{reason(item, today)}</small>
                  </span>
                </label>
              ))}
              {row.items.length < rowSize && (
                <Link to="/" className="suggest-card suggest-nudge">
                  <span className="pick-icon" aria-hidden="true">
                    <Plus size={20} />
                  </span>
                  <span className="pick-text">
                    <b className="pick-title">Import recipes</b>
                    <small>More recipes, better ideas</small>
                  </span>
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
