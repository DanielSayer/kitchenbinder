import { type ReactNode, useId } from "react";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: ReactNode;
};

type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group name, e.g. "View". */
  label: string;
  /** Show icons only; labels stay available to assistive technology. */
  iconOnly?: boolean;
  className?: string;
};

/**
 * Segmented control (list/grid, by aisle/by recipe). Native radios underneath,
 * so arrow keys, form semantics and screen readers work for free.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  iconOnly,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset
      className={["pantry-seg", className].filter(Boolean).join(" ")}
      data-icon-only={iconOnly || undefined}
    >
      <legend className="pantry-visually-hidden">{label}</legend>
      {options.map((option) => (
        <label key={option.value} title={iconOnly ? option.label : undefined}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            aria-label={iconOnly ? option.label : undefined}
          />
          {option.icon}
          {iconOnly ? null : <span>{option.label}</span>}
        </label>
      ))}
    </fieldset>
  );
}
