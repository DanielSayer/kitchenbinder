import { X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type SheetProps = {
  open: boolean;
  /** Called with false on Esc, backdrop tap, drag-down or the close button. */
  onOpenChange: (open: boolean) => void;
  /** Accessible title. Shown as the sheet heading unless `hideTitle`. */
  title: ReactNode;
  hideTitle?: boolean;
  description?: ReactNode;
  children?: ReactNode;
  /** Pinned actions under the scrolling body (e.g. primary + ghost button). */
  footer?: ReactNode;
  /** Layout from 700px up. Mobile is always a bottom sheet. */
  desktop?: "center" | "side";
  /** Element to focus on open. Defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Keep in sync with --t-sheet; exit animation duration. */
export const SHEET_EXIT_MS = 260;
const DRAG_CLOSE_PX = 90;

function focusables(root: HTMLElement) {
  return Array.from(
    root.querySelectorAll<HTMLElement>(focusableSelector),
  ).filter((element) => !element.closest("[hidden],[inert]"));
}

/**
 * Bottom sheet on mobile, dialog (or side panel) on desktop.
 * Modal: traps focus, closes on Esc / backdrop / drag-down, restores focus.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  description,
  children,
  footer,
  desktop = "center",
  initialFocus,
  className,
}: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [dragY, setDragY] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), SHEET_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Focus in on open, restore on close; lock page scroll while open.
  useEffect(() => {
    if (!open || !mounted) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const root = panel.current;
    if (root) {
      const target =
        initialFocus?.current ??
        (body.current && focusables(body.current)[0]) ??
        root;
      target.focus({ preventScroll: true });
    }
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      restoreFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open, mounted, initialFocus]);

  if (!mounted || typeof document === "undefined") return null;

  const close = () => onOpenChangeRef.current(false);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = focusables(panel.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, event.clientY - dragStart.current));
  };
  const onDragEnd = () => {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dragY > DRAG_CLOSE_PX) close();
    setDragY(0);
  };

  return createPortal(
    <div
      className="pantry-sheet-root"
      data-state={open ? "open" : "closed"}
      data-desktop={desktop}
    >
      <div className="pantry-sheet-scrim" aria-hidden="true" onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={["pantry-sheet", className].filter(Boolean).join(" ")}
        style={
          dragY
            ? { transform: `translateY(${dragY}px)`, transition: "none" }
            : undefined
        }
        onKeyDown={onKeyDown}
      >
        <div
          className="pantry-sheet-handle"
          aria-hidden="true"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <span />
        </div>
        <div className="pantry-sheet-head" data-hidden={hideTitle || undefined}>
          <h2 id={titleId} className="pantry-sheet-title">
            {title}
          </h2>
          <button
            type="button"
            className="pantry-sheet-close"
            aria-label="Close"
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
          {description ? (
            <p id={descriptionId} className="pantry-sheet-description">
              {description}
            </p>
          ) : null}
        </div>
        <div ref={body} className="pantry-sheet-body">
          {children}
        </div>
        {footer ? <div className="pantry-sheet-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
