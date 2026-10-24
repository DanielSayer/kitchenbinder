import type { RecipeContent } from "@prep-sheet/db/recipe-content";
import {
  ArrowLeft,
  Check,
  ListChecks,
  Timer as TimerIcon,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Sheet } from "@/components/pantry";
import { useWakeLock } from "./keep-awake";
import { splitQuantity } from "./scale-ingredients";
import {
  formatClock,
  ingredientsUsed,
  type StepDuration,
  stepDurations,
} from "./step-timers";

type RunningTimer = {
  id: string;
  step: number;
  label: string;
  total: number;
  endsAt: number;
};

function highlight(step: string, durations: StepDuration[]) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const duration of durations) {
    parts.push(step.slice(cursor, duration.start));
    parts.push(<em key={duration.start}>{duration.text}</em>);
    cursor = duration.end;
  }
  parts.push(step.slice(cursor));
  return parts;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function chime() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const gain = audio.createGain();
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(0.2, audio.currentTime);
    for (const [index, frequency] of [880, 660, 880].entries()) {
      const tone = audio.createOscillator();
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(audio.currentTime + index * 0.25);
      tone.stop(audio.currentTime + index * 0.25 + 0.18);
    }
    window.setTimeout(() => void audio.close(), 1200);
  } catch {
    /* Sound and vibration are best-effort. */
  }
}

/**
 * Full-screen dark cook mode: one big step at a time, timers from the step
 * text, ingredients on demand and the screen kept awake.
 */
export function CookMode({
  recipeId,
  content,
  factor = 1,
  ingredientChecks,
  onClose,
  onFinish,
}: {
  recipeId: string;
  content: RecipeContent;
  /** Servings scale for the ingredients sheet. */
  factor?: number;
  ingredientChecks?: {
    keys: string[];
    checked: Set<string>;
    toggle: (key: string) => void;
  };
  onClose: () => void;
  /** Last step's "Done": log the cook. */
  onFinish: () => void;
}) {
  const steps = content.steps.length ? content.steps : ["Enjoy your meal."];
  const storageKey = `prep-sheet:cook-step:${recipeId}`;
  const [index, setIndex] = useState(() => {
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      return Number.isInteger(saved) && saved > 0 && saved < steps.length
        ? saved
        : 0;
    } catch {
      return 0;
    }
  });
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [ingredientsOpen, setIngredientsOpen] = useState(false);
  const { supported, status } = useWakeLock(true);
  const now = useNow(timers.length > 0);
  const root = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, String(index));
    } catch {
      /* Resume-on-reopen is best-effort. */
    }
  }, [storageKey, index]);

  // Modal: lock page scroll and take focus.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    root.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  // Finished timers chime once and drop off.
  useEffect(() => {
    const done = timers.filter((timer) => timer.endsAt <= now);
    if (!done.length) return;
    setTimers((current) => current.filter((timer) => timer.endsAt > now));
    chime();
    for (const timer of done)
      toast.success(`Timer done: ${timer.label} (step ${timer.step + 1})`, {
        duration: 15000,
      });
  }, [now, timers]);

  const go = (next: number) =>
    setIndex(Math.max(0, Math.min(steps.length - 1, next)));
  const last = index === steps.length - 1;
  const step = steps[index] ?? "";
  const durations = stepDurations(step);
  const uses = ingredientsUsed(step, content.ingredients);

  const toggleTimer = (duration: StepDuration) => {
    const id = `${index}:${duration.start}`;
    setTimers((current) =>
      current.some((timer) => timer.id === id)
        ? current.filter((timer) => timer.id !== id)
        : [
            ...current,
            {
              id,
              step: index,
              label: duration.text,
              total: duration.seconds,
              endsAt: Date.now() + duration.seconds * 1000,
            },
          ],
    );
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (ingredientsOpen) return;
    if (event.key === "Escape") onClose();
    else if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "ArrowLeft") go(index - 1);
  };

  const awakeLabel = !supported
    ? "Keep the screen on"
    : status === "active"
      ? "Screen stays on"
      : status === "error"
        ? "Screen may sleep"
        : "Keeping screen on…";

  return createPortal(
    <div
      ref={root}
      className="cook-mode"
      role="dialog"
      aria-modal="true"
      aria-label={`Cook mode: ${content.title}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="cook-top">
        <button
          type="button"
          className="cook-icon-button"
          aria-label="Close cook mode"
          onClick={onClose}
        >
          <X size={22} aria-hidden="true" />
        </button>
        <span className="cook-awake" data-status={status} role="status">
          <i aria-hidden="true" />
          {awakeLabel}
        </span>
        <button
          type="button"
          className="cook-icon-button"
          aria-label="Ingredients"
          aria-haspopup="dialog"
          onClick={() => setIngredientsOpen(true)}
        >
          <ListChecks size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="cook-progress" aria-hidden="true">
        {steps.map((_, stepIndex) => (
          <i
            key={stepIndex}
            className="cook-progress-bar"
            data-done={stepIndex <= index || undefined}
          />
        ))}
      </div>

      {timers.length ? (
        <section className="cook-timers" aria-label="Running timers">
          {timers.map((timer) => (
            <button
              key={timer.id}
              type="button"
              className="cook-timer-pill"
              onClick={() => go(timer.step)}
            >
              <TimerIcon size={14} aria-hidden="true" />
              Step {timer.step + 1} · {formatClock((timer.endsAt - now) / 1000)}
            </button>
          ))}
        </section>
      ) : null}

      <div
        className="cook-stage"
        onPointerDown={(event) => {
          swipeStart.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (swipeStart.current === null) return;
          const delta = event.clientX - swipeStart.current;
          swipeStart.current = null;
          if (Math.abs(delta) > 60) go(index + (delta < 0 ? 1 : -1));
        }}
      >
        <div className="cook-step" key={index} aria-live="polite">
          <p className="cook-step-number">
            <b>{index + 1}</b> of {steps.length}
          </p>
          <p className="cook-step-text">{highlight(step, durations)}</p>
          {uses.length ? (
            <ul className="cook-uses" aria-label="Uses">
              {uses.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : null}
          {durations.map((duration) => {
            const running = timers.find(
              (timer) => timer.id === `${index}:${duration.start}`,
            );
            return (
              <button
                key={duration.start}
                type="button"
                className="cook-timer"
                data-running={running ? true : undefined}
                aria-pressed={!!running}
                onClick={() => toggleTimer(duration)}
              >
                <TimerIcon size={20} aria-hidden="true" />
                {running ? (
                  <span>
                    {formatClock((running.endsAt - now) / 1000)}
                    <span className="pantry-visually-hidden">
                      {" "}
                      left. Stop timer
                    </span>
                  </span>
                ) : (
                  <span>Start {formatClock(duration.seconds)} timer</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="cook-foot">
        <p className="cook-hint" aria-hidden="true">
          Swipe or use ← → to move between steps
        </p>
        <div className="cook-nav">
          <button
            type="button"
            className="cook-icon-button cook-prev"
            aria-label="Previous step"
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ArrowLeft size={24} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="button button-primary cook-next"
            onClick={() => (last ? onFinish() : go(index + 1))}
          >
            {last ? (
              <>
                <Check size={20} aria-hidden="true" /> Done · log this cook
              </>
            ) : (
              "Next step"
            )}
          </button>
        </div>
      </div>

      <Sheet
        open={ingredientsOpen}
        onOpenChange={setIngredientsOpen}
        title="Ingredients"
      >
        <ul className="cook-ingredient-list">
          {content.ingredients.map((ingredient, ingredientIndex) => {
            const key = ingredientChecks?.keys[ingredientIndex] ?? "";
            const { quantity, rest } = splitQuantity(ingredient, factor);
            const text = (
              <span className="ingredient-text">
                {quantity ? <b>{quantity}</b> : null}
                {rest}
              </span>
            );
            return (
              <li key={key || ingredientIndex}>
                {ingredientChecks ? (
                  <label className="ingredient-row">
                    <input
                      type="checkbox"
                      className="ingredient-input"
                      checked={ingredientChecks.checked.has(key)}
                      onChange={() => ingredientChecks.toggle(key)}
                    />
                    <span className="ingredient-check" aria-hidden="true">
                      <Check size={16} />
                    </span>
                    {text}
                  </label>
                ) : (
                  text
                )}
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>,
    document.body,
  );
}
