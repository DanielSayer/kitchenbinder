import { createFileRoute, Link } from "@tanstack/react-router";
import { ReportForm } from "@/components/report-form";
import { SupportContact } from "@/components/support-contact";
import { getSupportContact } from "@/functions/get-support-contact";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/support")({
  loader: () => getSupportContact(),
  component: Support,
});

function Support() {
  const { email } = Route.useLoaderData();
  const { data: session, isPending } = authClient.useSession();
  return (
    <main id="main-content" className="page-width help-page">
      <div className="page-heading">
        <div>
          <h1>
            Support<span className="title-dot">.</span>
          </h1>
          <p>Something went wrong? Tell us what happened.</p>
        </div>
      </div>
      <section className="help-section">
        <h2>Get help</h2>
        <SupportContact email={email} />
        <p>
          Your sign-in provider manages your password and sign-in email. Prep
          Sheet account deletion is available in{" "}
          <Link to="/settings">account settings</Link>.
        </p>
      </section>
      {isPending ? (
        <p role="status">Checking sign-in...</p>
      ) : session ? (
        <ReportForm />
      ) : (
        <section className="help-section">
          <h2>Report a problem</h2>
          <p>Sign in to send a report linked to your Prep Sheet account.</p>
          <Link to="/login" className="button button-primary">
            Sign in
          </Link>
        </section>
      )}
      <p>
        <Link to="/privacy" className="text-button">
          How we handle your information
        </Link>
      </p>
    </main>
  );
}
