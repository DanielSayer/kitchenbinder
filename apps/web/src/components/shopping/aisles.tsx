import type { shoppingCategories } from "@prep-sheet/db/shopping-plan";
import {
  BookOpen,
  Carrot,
  Croissant,
  Fish,
  type LucideIcon,
  Milk,
  NotebookPen,
  ShoppingBasket,
  Snowflake,
  SprayCan,
  Wheat,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PantryTone } from "@/components/pantry";

type Category = (typeof shoppingCategories)[number];

const aisles: Record<Category, { icon: LucideIcon; tone: PantryTone }> = {
  Produce: { icon: Carrot, tone: "olive" },
  "Meat & seafood": { icon: Fish, tone: "sage" },
  "Dairy & eggs": { icon: Milk, tone: "plum" },
  Bakery: { icon: Croissant, tone: "butter" },
  Pantry: { icon: Wheat, tone: "butter" },
  Frozen: { icon: Snowflake, tone: "sage" },
  "Cleaning & household": { icon: SprayCan, tone: "plum" },
  Other: { icon: ShoppingBasket, tone: "tomato" },
};

/** Group heading with a tinted icon tile and a count. */
export function AisleHeading({
  title,
  count,
  category,
  kind,
  id,
}: {
  title: ReactNode;
  count: number;
  category?: Category;
  /** By-recipe groups: a recipe or the manual "Other groceries" group. */
  kind?: "recipe" | "manual";
  id?: string;
}) {
  const meta = category ? aisles[category] : undefined;
  const Icon = meta?.icon ?? (kind === "manual" ? NotebookPen : BookOpen);
  const tone = meta?.tone ?? "tomato";
  return (
    <div className="shop-aisle" data-tone={tone}>
      <span className="shop-aisle-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <h2 id={id}>{title}</h2>
      <span className="shop-aisle-count">
        {count}
        <span className="pantry-visually-hidden">
          {count === 1 ? " item" : " items"}
        </span>
      </span>
    </div>
  );
}

/** "12 left" with an olive progress bar. */
export function ShopProgress({ left, total }: { left: number; total: number }) {
  const done = total ? ((total - left) / total) * 100 : 0;
  return (
    <div className="shop-progress">
      <span role="status">
        <b>{left}</b> left
      </span>
      <span className="shop-progress-bar" aria-hidden="true">
        <i style={{ width: `${done}%` }} />
      </span>
    </div>
  );
}
