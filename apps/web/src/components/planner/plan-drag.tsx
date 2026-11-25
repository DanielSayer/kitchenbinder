import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
} from "@dnd-kit/core";
import { type ReactNode, useMemo, useState, useSyncExternalStore } from "react";
import type { DropTarget } from "./meal-moves";

const BOARD_QUERY = "(min-width: 1024px)";

function subscribeBoard(onChange: () => void) {
  const query = window.matchMedia?.(BOARD_QUERY);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** Wide screens show the week as a 7-column board. */
export function useBoard() {
  return useSyncExternalStore(
    subscribeBoard,
    () => window.matchMedia?.(BOARD_QUERY).matches ?? false,
    () => false,
  );
}

const mealDropId = (id: string) => `meal:${id}`;

/** Prefer a meal under the pointer (swap) over its day (move). */
const collide: CollisionDetection = (args) => {
  const own = mealDropId(String(args.active.id));
  const hits = pointerWithin(args).filter((hit) => hit.id !== own);
  const meal = hits.find((hit) => String(hit.id).startsWith("meal:"));
  return meal ? [meal] : hits.slice(0, 1);
};

/** A click straight after a drop belongs to the drag, not the card. */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(
    () => window.removeEventListener("click", swallow, { capture: true }),
    0,
  );
}

/**
 * Drag meals between days. Phones lift a card with a long press; the board
 * (wide screens) also drags with the mouse. The meal editor's date field is
 * the non-drag way to move a meal.
 */
export function PlanDrag({
  board,
  onDrop,
  overlay,
  children,
}: {
  board: boolean;
  onDrop: (id: string, target: DropTarget) => void;
  overlay: (id: string) => ReactNode;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const mouse = useSensor(MouseSensor, {
    activationConstraint: { distance: 6 },
  });
  const touch = useSensor(TouchSensor, {
    activationConstraint: { delay: 300, tolerance: 8 },
  });
  const sensors = useMemo(
    () => (board ? [mouse, touch] : [touch]),
    [board, mouse, touch],
  );
  const end = (event: DragEndEvent) => {
    setActive(null);
    swallowNextClick();
    const target = event.over?.data.current as DropTarget | undefined;
    if (target) onDrop(String(event.active.id), target);
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      onDragStart={(event) => {
        setActive(String(event.active.id));
        navigator.vibrate?.(10);
      }}
      onDragEnd={end}
      onDragCancel={() => setActive(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Drag to another day to move this meal, or onto a meal to swap them.",
        },
      }}
    >
      {children}
      {active && !board && (
        <p className="plan-drag-hint" role="status">
          Drop on a day to move · on a meal to swap
        </p>
      )}
      <DragOverlay dropAnimation={null}>
        {active ? (
          <div className="plan-drag-overlay">{overlay(active)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export type MealDrag = {
  /** For the meal's list item: dropping another meal here swaps them. */
  dropRef: (node: HTMLElement | null) => void;
  /** For the card that lifts. */
  dragRef: (node: HTMLElement | null) => void;
  listeners: DraggableSyntheticListeners;
  dragging: boolean;
  swap: boolean;
};

export function DragMeal({
  id,
  children,
}: {
  id: string;
  children: (drag: MealDrag) => ReactNode;
}) {
  const drag = useDraggable({ id });
  const drop = useDroppable({
    id: mealDropId(id),
    data: { kind: "meal", id } satisfies DropTarget,
  });
  return children({
    dropRef: drop.setNodeRef,
    dragRef: drag.setNodeRef,
    listeners: drag.listeners,
    dragging: drag.isDragging,
    swap: drop.isOver,
  });
}

/** A day that takes dropped meals. `id` is unique per target, e.g. strip vs agenda. */
export function DropDay({
  id,
  date,
  children,
}: {
  id: string;
  date: string;
  children: (drop: {
    ref: (node: HTMLElement | null) => void;
    over: boolean;
  }) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { kind: "day", date } satisfies DropTarget,
  });
  return children({ ref: setNodeRef, over: isOver });
}
