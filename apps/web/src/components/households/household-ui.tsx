import type { AppRouter } from "@prep-sheet/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { Check } from "lucide-react";
import { type CSSProperties, useId } from "react";
import {
  isPantryTone,
  type PantryTone,
  pantryTones,
  toneColor,
  toneFor,
} from "@/components/pantry";
import { initialsOf } from "@/components/shell/destinations";

export type HouseholdSummary =
  inferRouterOutputs<AppRouter>["households"]["list"][number];

export function householdTone(color: string | null | undefined): PantryTone {
  return isPantryTone(color) ? color : "sage";
}

/** Vertical colour bar marking a household row. */
export function HouseholdMark({ color }: { color: string | null | undefined }) {
  return (
    <span
      className="household-mark"
      aria-hidden="true"
      style={{ "--hc": toneColor(householdTone(color)) } as CSSProperties}
    />
  );
}

export function memberCount(count: number) {
  return `${count} ${count === 1 ? "member" : "members"}`;
}

/** Overlapping initials, up to `max`. Decorative: the row text names counts. */
export function MemberAvatars({
  members,
  max = 3,
}: {
  members: readonly { id: string; name: string }[];
  max?: number;
}) {
  if (members.length < 2) return null;
  return (
    <span className="household-avatars" aria-hidden="true">
      {members.slice(0, max).map((member) => (
        <MemberAvatar key={member.id} member={member} />
      ))}
    </span>
  );
}

export function MemberAvatar({
  member,
}: {
  member: { id: string; name: string };
}) {
  return (
    <span
      className="avatar"
      style={{ background: toneColor(toneFor(member.id)) }}
    >
      {initialsOf(member.name)}
    </span>
  );
}

const toneNames: Record<PantryTone, string> = {
  tomato: "Tomato",
  olive: "Olive",
  butter: "Butter",
  plum: "Plum",
  sage: "Sage",
};

/** Radio group of the five household colours. */
export function ColourPicker({
  value,
  onChange,
  disabled,
  label = "Colour",
}: {
  value: PantryTone;
  onChange: (tone: PantryTone) => void;
  disabled?: boolean;
  label?: string;
}) {
  const name = useId();
  return (
    <fieldset className="household-colours" disabled={disabled}>
      <legend>{label}</legend>
      <div>
        {pantryTones.map((tone) => (
          <label
            key={tone}
            style={{ "--hc": toneColor(tone) } as CSSProperties}
            title={toneNames[tone]}
          >
            <input
              type="radio"
              name={name}
              value={tone}
              checked={value === tone}
              onChange={() => onChange(tone)}
            />
            <span aria-hidden="true">
              {value === tone ? <Check size={18} /> : null}
            </span>
            <span className="pantry-visually-hidden">{toneNames[tone]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Pull a 64-hex invite token out of a pasted link or code. */
export function inviteTokenFrom(value: string) {
  return value.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase() ?? null;
}
