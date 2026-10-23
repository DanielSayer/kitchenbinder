import { Link } from "@tanstack/react-router";
import { HouseholdSwitch } from "@/components/households/household-switch";
import { BrandMark } from "@/components/pantry/brand-mark";

/**
 * Mobile top band (mark + household chip) for screens without binder tabs.
 * Matches the Recipes binder row; desktop uses the app header instead.
 */
export function PageBar() {
  return (
    <div className="page-bar">
      <Link to="/" className="page-bar-mark" aria-label="Kitchenbinder home">
        <BrandMark size={28} />
      </Link>
      <HouseholdSwitch className="page-bar-household" />
    </div>
  );
}
