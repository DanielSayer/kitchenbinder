import { Link } from "@tanstack/react-router";
import { HouseholdMenu } from "./households/household-menu";
import { InstallSuggestion } from "./install-app";
import { BrandMark, Wordmark } from "./pantry/brand-mark";
import { mainDestinations } from "./shell/destinations";
import { TabBar } from "./shell/tab-bar";
import UserMenu from "./user-menu";

/**
 * App chrome. Desktop: mark + wordmark, household menu, top nav, account menu.
 * Mobile: slim bar with the mark; navigation in the tab bar.
 */
export default function Header() {
  return (
    <>
      <header className="site-header">
        <Link to="/" className="brand" aria-label="Kitchenbinder home">
          <BrandMark className="brand-icon" size={30} />
          <Wordmark />
        </Link>
        <HouseholdMenu />

        <nav className="top-nav" aria-label="Main navigation">
          {mainDestinations.map(
            ({ to, label, desktopLabel, icon: Icon, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact }}
                activeProps={{ className: "active", "aria-current": "page" }}
                aria-label={desktopLabel}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="nav-desktop-label">{desktopLabel}</span>
                <span className="nav-mobile-label">{label}</span>
              </Link>
            ),
          )}
        </nav>

        <div className="site-header-end">
          <div className="nav-account">
            <UserMenu />
          </div>
        </div>
      </header>
      <TabBar />
      <InstallSuggestion />
    </>
  );
}
