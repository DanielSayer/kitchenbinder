import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { LargeTitle } from "@/components/pantry";

/** A "You" subpage: back to settings, a large title, then the content. */
export function SettingsPage({
  title,
  sub,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      id="main-content"
      className={["page-width you-page settings-page", className]
        .filter(Boolean)
        .join(" ")}
    >
      <Link to="/settings" className="back-link settings-back">
        <ArrowLeft size={17} aria-hidden="true" /> Settings
      </Link>
      <LargeTitle sub={sub} actions={actions}>
        {title}
      </LargeTitle>
      {children}
    </main>
  );
}
