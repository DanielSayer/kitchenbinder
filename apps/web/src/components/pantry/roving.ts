import type { KeyboardEvent } from "react";

/**
 * Arrow/Home/End handling for a horizontal roving-tabindex group.
 * Returns the next index, or undefined when the key isn't handled.
 */
export function nextRovingIndex(
  event: KeyboardEvent,
  index: number,
  count: number,
) {
  let next: number;
  if (event.key === "ArrowRight" || event.key === "ArrowDown")
    next = (index + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
    next = (index - 1 + count) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else return undefined;
  event.preventDefault();
  return next;
}
