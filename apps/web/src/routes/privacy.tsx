import { createFileRoute } from "@tanstack/react-router";
import { PrivacyPolicy } from "@/components/privacy-policy";

export const Route = createFileRoute("/privacy")({ component: Privacy });

function Privacy() {
  return (
    <main id="main-content" className="page-width help-page privacy-page">
      <div className="page-heading">
        <div>
          <h1>
            Privacy<span className="title-dot">.</span>
          </h1>
          <p>How Kitchenbinder handles your recipes and account.</p>
        </div>
      </div>
      <PrivacyPolicy />
    </main>
  );
}
