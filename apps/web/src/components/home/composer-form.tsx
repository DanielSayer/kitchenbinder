import { ArrowUp, Pencil, Sparkles } from "lucide-react";
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
    <>
      <form className="add-composer" onSubmit={onSubmit}>
        <label className="pantry-visually-hidden" htmlFor="recipe-input">
          Paste a link, recipe, or describe a dish
        </label>
        <textarea
          id="recipe-input"
          ref={inputRef}
          value={input}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Cmd/Ctrl+Enter sends; plain Enter keeps pasted recipes multi-line.
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={20000}
          placeholder="Paste a link, recipe, or describe a dish…"
        />
        <div className="add-composer-foot">
          <span>
            <Sparkles size={14} aria-hidden="true" />
            We'll tidy it into a recipe
          </span>
          <button
            type="submit"
            className="add-send"
            aria-label="Make a recipe"
            title="Make a recipe"
            disabled={disabled}
          >
            <ArrowUp size={22} aria-hidden="true" />
          </button>
        </div>
      </form>
      <button
        type="button"
        className="add-manual"
        disabled={manualDisabled}
        onClick={onManual}
      >
        <Pencil size={16} aria-hidden="true" /> Enter manually
      </button>
    </>
  );
}
