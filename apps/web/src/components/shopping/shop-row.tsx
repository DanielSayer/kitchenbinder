import { Check, House, MoreHorizontal } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { useMeasurePreferences } from "@/components/preferences";
import { displayLine } from "../recipes/scale-ingredients";
import type { Item } from "./shopping-groups";

const SWIPE_COMMIT_PX = 96;

/**
 * One list row. Tap to tick; swipe left (or the Have it button, shown on
 * desktop and to keyboard/screen-reader users) to mark it already at home.
 */
export function ShopRow({
  item,
  label,
  quantity,
  expanded,
  note,
  swipeable,
  nudge,
  onToggle,
  onHave,
  onNeed,
  onMore,
}: {
  item: Item;
  /** Name for a combined row, in place of the item's text. */
  label?: string;
  /** Combined total, shown beside the name. */
  quantity?: string | null;
  /** Set for combined rows: whether their lines are shown. */
  expanded?: boolean;
  note?: string | null;
  swipeable: boolean;
  nudge?: boolean;
  onToggle: () => void;
  onHave: () => void;
  onNeed: () => void;
  onMore: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; axis?: "x" } | null>(null);
  const offset = useRef(0);
  const swiped = useRef(false);
  const move = (value: number) => {
    offset.current = value;
    setDx(value);
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeable || (event.pointerType === "mouse" && event.button !== 0))
      return;
    drag.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const mx = event.clientX - current.x;
    const my = event.clientY - current.y;
    if (!current.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        current.axis = "x";
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      } else if (Math.abs(my) > 8) {
        drag.current = null;
        return;
      } else return;
    }
    move(Math.min(0, mx));
  };
  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.axis !== "x") return;
    swiped.current = true;
    setDragging(false);
    const width = row.current?.offsetWidth ?? 320;
    if (offset.current < -Math.min(SWIPE_COMMIT_PX, width * 0.3)) {
      move(-width);
      window.setTimeout(onHave, 160);
    } else move(0);
  };
  const onPointerCancel = () => {
    drag.current = null;
    setDragging(false);
    move(0);
  };
  const bought = item.status === "bought";
  const measures = useMeasurePreferences();
  const name = label ?? item.text;
  return (
    <li className="shop-item" data-nudge={nudge || undefined}>
      {swipeable && (
        <div className="shop-under" aria-hidden="true">
          <House size={18} />
          Have it
        </div>
      )}
      <div
        ref={row}
        className="shop-row"
        data-done={item.status !== "needed" || undefined}
        data-dragging={dragging || undefined}
        data-swipe={swipeable || undefined}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={(event) => {
          if (!swiped.current) return;
          swiped.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <label className="shop-tick">
          <input
            type="checkbox"
            className="pantry-visually-hidden"
            checked={bought}
            aria-label={`${bought ? "Mark needed" : "Mark bought"}: ${name}`}
            onChange={onToggle}
          />
          <span className="shop-check" aria-hidden="true">
            <Check size={16} />
          </span>
          <span className="shop-text">
            <b className="shop-name">
              {label ?? displayLine(item.text, item.ingredient, measures)}
            </b>{" "}
            {note && <small>{note}</small>}
          </span>
          {quantity && <span className="shop-qty">{quantity}</span>}
        </label>
        {item.status === "needed" ? (
          <button
            type="button"
            className="shop-have"
            aria-label={`Already have it: ${name}`}
            onClick={onHave}
          >
            <House size={16} aria-hidden="true" />
            <span>Have it</span>
          </button>
        ) : item.status === "owned" ? (
          <button
            type="button"
            className="shop-have"
            data-visible
            aria-label={`Need this: ${name}`}
            onClick={onNeed}
          >
            Need this
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button shop-more"
          aria-label={
            expanded === undefined
              ? `Actions for ${name}`
              : `${expanded ? "Hide" : "Show"} lines for ${name}`
          }
          aria-expanded={expanded}
          onClick={onMore}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </li>
  );
}
