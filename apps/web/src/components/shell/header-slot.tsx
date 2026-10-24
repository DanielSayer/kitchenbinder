import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

type HeaderSlotContextValue = {
  node: HTMLElement | null;
  setNode: (node: HTMLElement | null) => void;
};

const HeaderSlotContext = createContext<HeaderSlotContextValue | null>(null);

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ node, setNode }), [node]);
  return (
    <HeaderSlotContext.Provider value={value}>
      {children}
    </HeaderSlotContext.Provider>
  );
}

/** Where slotted content appears. Rendered once by the app header. */
export function HeaderSlotOutlet({ className }: { className?: string }) {
  const context = useContext(HeaderSlotContext);
  return (
    <div
      ref={context?.setNode}
      className={["header-slot", className].filter(Boolean).join(" ")}
    />
  );
}

/**
 * Render children into the app header (right of the mark on mobile, before the
 * account menu on desktop). Used for the global household chip.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const context = useContext(HeaderSlotContext);
  if (!context?.node) return null;
  return createPortal(children, context.node);
}
