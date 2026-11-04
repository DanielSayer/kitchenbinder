import { Drawer } from "@base-ui/react/drawer";
import { X } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useRef,
  useSyncExternalStore,
} from "react";

export type SheetProps = {
  open: boolean;
  /** Called with false on Esc, backdrop tap, swipe-down or the close button. */
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
  /** Element to focus on open. Defaults to the first focusable body element. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
};

/** Keep in sync with the 700px breakpoint in pantry.css. */
const DESKTOP_QUERY = "(min-width: 700px)";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function firstFocusable(root: HTMLElement | null) {
  if (!root) return null;
  return (
    Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).find(
      (element) => !element.closest("[hidden],[inert]"),
    ) ?? null
  );
}

function subscribeDesktop(onChange: () => void) {
  const query = window.matchMedia?.(DESKTOP_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function useDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia?.(DESKTOP_QUERY).matches ?? false,
    () => false,
  );
}

/**
 * Bottom sheet on mobile, dialog (or side panel) on desktop. Built on Base UI
 * Drawer: swipe to dismiss with velocity, focus trap, scroll lock, Esc /
 * backdrop close, focus restore and software keyboard handling.
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
  const isDesktop = useDesktop();
  const popup = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const side = isDesktop && desktop === "side";

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      swipeDirection={side ? "right" : "down"}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Backdrop className="pantry-sheet-scrim" />
          <Drawer.Viewport className="pantry-sheet-root" data-desktop={desktop}>
            <Drawer.Popup
              ref={popup}
              className={["pantry-sheet", className].filter(Boolean).join(" ")}
              initialFocus={() =>
                initialFocus?.current ??
                firstFocusable(body.current) ??
                popup.current
              }
            >
              <div className="pantry-sheet-handle" aria-hidden="true">
                <span />
              </div>
              <div
                className="pantry-sheet-head"
                data-hidden={hideTitle || undefined}
              >
                <Drawer.Title className="pantry-sheet-title">
                  {title}
                </Drawer.Title>
                <Drawer.Close className="pantry-sheet-close" aria-label="Close">
                  <X size={20} aria-hidden="true" />
                </Drawer.Close>
                {description ? (
                  <Drawer.Description className="pantry-sheet-description">
                    {description}
                  </Drawer.Description>
                ) : null}
              </div>
              <Drawer.Content ref={body} className="pantry-sheet-body">
                {children}
              </Drawer.Content>
              {footer ? (
                <div className="pantry-sheet-footer">{footer}</div>
              ) : null}
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  );
}
