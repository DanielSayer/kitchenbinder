import { pricing } from "@prep-sheet/api/billing/policy";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { authClient } from "@/lib/auth-client";

export function PlanCards({
  freeAction,
  proAction,
  trialEligible = true,
}: {
  freeAction: ReactNode;
  proAction: ReactNode;
  trialEligible?: boolean;
}) {
  return (
    <div className="plan-grid">
      <article className="plan-card">
        <span className="plan-eyebrow">Your everyday favourites</span>
        <h3>Free</h3>
        <p className="plan-description">A little cookbook to call your own.</p>
        <p className="plan-price">
          A$0 <span>/ forever</span>
        </p>
        <p className="plan-terms">No subscription needed.</p>
        {freeAction}
        <ul className="plan-features">
          {[
            `Save up to ${pricing.free.recipes} recipes`,
            `${pricing.free.aiCredits} AI credits to try imports or recipe ideas`,
            "Plan meals and make shopping lists",
            "Cook step by step and print recipes",
            "Join a shared household",
          ].map((feature) => (
            <li key={feature}>
              <Check size={18} aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </article>
      <article className="plan-card plan-card-pro">
        <span className="plan-eyebrow">Room for every recipe</span>
        <h3>Pro</h3>
        <p className="plan-description">
          For a growing cookbook and a shared kitchen.
        </p>
        <p className="plan-price">
          A$4.99 <span>/ month</span>
        </p>
        <p className="plan-terms">
          {trialEligible && pricing.trial.days > 0
            ? `${pricing.trial.days}-day free trial. `
            : "Billed monthly in AUD. "}
          Cancel anytime.
        </p>
        {proAction}
        <ul className="plan-features">
          {[
            "Everything in Free",
            "Unlimited saved recipes",
            `${pricing.pro.aiCredits} AI credits each month on the paid plan`,
            "Create a household and invite others",
            "Keep your recipes if you cancel",
          ].map((feature) => (
            <li key={feature}>
              <Check size={18} aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        {trialEligible && pricing.trial.days > 0 && (
          <div className="plan-trial">
            <strong>{pricing.trial.days} days free to try Pro</strong>
            <p>
              Includes {pricing.trial.aiCredits} AI credits for the whole trial.
              Then A$4.99/month unless you cancel. Check the final price and
              renewal date at checkout.
            </p>
          </div>
        )}
      </article>
    </div>
  );
}

export function PublicPlans() {
  const { data: session } = authClient.useSession();
  return (
    <PlanCards
      freeAction={
        <Link to="/login" className="button button-outline">
          Get started free
        </Link>
      }
      proAction={
        <Link
          to={session ? "/settings" : "/login"}
          search={{ billing: "1" }}
          className="button button-primary"
        >
          {session ? "View your plan" : "Sign in to try Pro"}
        </Link>
      }
    />
  );
}

export function PricingFaq({
  heading = "A few things to know",
}: {
  heading?: string;
}) {
  return (
    <section className="pricing-faq" aria-labelledby="pricing-questions">
      <h2 id="pricing-questions">{heading}</h2>
      <details>
        <summary>How does the free trial work?</summary>
        <p>
          Eligible accounts can try Pro for {pricing.trial.days} days, with
          unlimited recipe storage and {pricing.trial.aiCredits} AI credits in
          total. Sign in, open Plan &amp; billing and start your trial. Review
          the payment and renewal terms at checkout, and cancel before renewal
          if you don't want to continue. Pro checkout must be available to start
          a trial.
        </p>
      </details>
      <details>
        <summary>What is an AI credit?</summary>
        <p>
          One credit covers one attempt to import or generate a recipe with AI.
          Once AI processing starts, the credit is used even if the attempt
          fails. Typing or editing a recipe uses no credits.
        </p>
        <p>
          Free credits are a one-time allowance. Paid Pro credits reset on the
          first of each month, UTC, and don't roll over. Deleting a recipe
          doesn't restore credits.
        </p>
      </details>
      <details>
        <summary>What happens if I cancel?</summary>
        <p>
          Your recipes stay readable, editable and exportable. When Pro ends,
          you return to Free. If you have {pricing.free.recipes} or more saved
          recipes, remove some or upgrade before adding another.
        </p>
      </details>
      <details>
        <summary>Does everyone in my household need Pro?</summary>
        <p>
          No. Pro lets you create a household and invite others. Free members
          can join and contribute within their own recipe and AI allowances.
          Meal plans and shopping lists stay personal to each account.
        </p>
      </details>
    </section>
  );
}
