import { type ExternalToast, toast } from "sonner";

export type UndoToastOptions = {
  /** Revert the change. Called at most once. */
  onUndo: () => void;
  /**
   * Called once if the toast closes without Undo (timeout, swipe, close).
   * Use it to commit deferred work, e.g. a real delete.
   */
  onCommit?: () => void;
  undoLabel?: string;
  /** Milliseconds. Defaults to 6000. */
  duration?: number;
  id?: ExternalToast["id"];
};

/**
 * "Undo, not are-you-sure": act immediately, then offer Undo.
 * Returns the toast id so callers can dismiss or replace it.
 */
export function undoToast(
  message: string,
  {
    onUndo,
    onCommit,
    undoLabel = "Undo",
    duration = 6000,
    id,
  }: UndoToastOptions,
) {
  let settled = false;
  const settle = (undo: boolean) => {
    if (settled) return;
    settled = true;
    if (undo) onUndo();
    else onCommit?.();
  };
  return toast(message, {
    id,
    duration,
    className: "pantry-undo-toast",
    action: { label: undoLabel, onClick: () => settle(true) },
    onAutoClose: () => settle(false),
    onDismiss: () => settle(false),
  });
}
