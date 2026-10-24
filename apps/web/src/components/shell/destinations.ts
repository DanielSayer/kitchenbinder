import { BookOpen, CalendarDays, Plus, ShoppingBasket } from "lucide-react";

/** Main destinations shared by the mobile tab bar and desktop top nav. */
export const mainDestinations = [
  {
    to: "/",
    label: "Add",
    desktopLabel: "Add a recipe",
    icon: Plus,
    exact: true,
  },
  {
    to: "/recipes",
    label: "Recipes",
    desktopLabel: "Recipes",
    icon: BookOpen,
    exact: false,
  },
  {
    to: "/shopping",
    label: "Shop",
    desktopLabel: "Shopping",
    icon: ShoppingBasket,
    exact: false,
  },
  {
    to: "/planner",
    label: "Plan",
    desktopLabel: "Planner",
    icon: CalendarDays,
    exact: false,
  },
] as const;

/** Paths that live under the "You" tab. */
export const youPaths = [
  "/settings",
  "/households",
  "/groups",
  "/pricing",
  "/privacy",
  "/support",
  "/login",
  "/connect-extension",
];

export function isYouPath(pathname: string) {
  return youPaths.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function initialsOf(name: string | null | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
