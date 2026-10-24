import { pricing } from "@prep-sheet/api/billing/policy";
import { Link } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

export function Hero() {
  const { data: session, isPending } = authClient.useSession();
  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">
        Every recipe,
        <br />
        <i>one tidy binder.</i>
      </h1>
      <p>Paste a link, some text, or just “nan's pie”. We'll do the tidying.</p>
      {!isPending && !session && (
        <Link to="/pricing" className="hero-pricing-link">
          Start free. Explore Pro and its {pricing.trial.days}-day free trial →
        </Link>
      )}
    </section>
  );
}
