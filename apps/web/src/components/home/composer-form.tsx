import { ArrowRight, Pencil } from "lucide-react";
import type { Ref, SubmitEvent } from "react";

export function ComposerForm({
  input,
  inputRef,
  disabled,
  onChange,
  onSubmit,
  onManual,
  manualDisabled,
}: {
  input: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onManual: () => void;
  manualDisabled: boolean;
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <label className="composer-label" htmlFor="recipe-input">
        What would you like to cook?
      </label>

      <textarea
        id="recipe-input"
        ref={inputRef}
        value={input}
        onChange={(event) => onChange(event.target.value)}
        maxLength={20000}
        placeholder="Paste a recipe or link, or tell us what's for dinner..."
      />

      <div className="composer-toolbar">
        <button
          type="button"
          className="composer-manual text-button"
          disabled={manualDisabled}
          onClick={onManual}
        >
          <Pencil size={16} aria-hidden="true" /> Enter manually
        </button>

        <button
          type="submit"
          className="button button-primary"
          disabled={disabled}
        >
          Make a recipe <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
