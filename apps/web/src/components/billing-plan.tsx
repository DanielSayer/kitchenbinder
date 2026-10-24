import type { AppRouter } from "@prep-sheet/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

type BillingStatus = inferRouterOutputs<AppRouter>["billing"]["status"];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function UsageMeter({
  label,
  value,
  limit,
  remaining = false,
}: {
  label: string;
  value: number;
  limit: number;
  remaining?: boolean;
}) {
  return (
    <div className="billing-meter">
      <div className="billing-meter-label">
        <span>{label}</span>
        <span>
          <strong>{value}</strong> / {limit} {remaining ? "left" : "saved"}
        </span>
      </div>
      <meter
        min={0}
        max={Math.max(1, limit)}
        value={Math.min(value, limit)}
        aria-label={label}
        aria-valuetext={`${value} of ${limit} ${remaining ? "remaining" : "saved"}`}
      />
    </div>
  );
}

export function BillingPlan({
  plan,
  action,
  secondaryActions,
}: {
  plan: BillingStatus;
  action: ReactNode;
  secondaryActions: ReactNode;
}) {
  const remaining = Math.max(0, plan.credits - plan.used);
  const atRecipeLimit = plan.recipes !== null && plan.saved >= plan.recipes;
  const ending =
    plan.tier === "pro" && plan.cancelAtPeriodEnd ? plan.validUntil : null;
  const creditsResetAt =
    plan.resetsAt && (!ending || new Date(plan.resetsAt) < new Date(ending))
      ? plan.resetsAt
      : null;

  return (
    <div className="billing-overview">
      <div className="billing-overview-header">
        <div className="billing-plan-identity">
          <h3>{plan.tier === "pro" ? "Pro" : "Free"}</h3>
          {plan.bucket === "trial" && (
            <span className="billing-plan-badge">Trial</span>
          )}
        </div>
        {action}
      </div>
      {plan.bucket === "trial" && !ending && plan.resetsAt && (
        <p className="billing-plan-note">
          Trial ends {formatDate(plan.resetsAt)}
          <span aria-hidden="true"> · </span>Pro A$4.99/month
        </p>
      )}
      <div className="billing-usage">
        <div className="billing-usage-item">
          {plan.recipes === null ? (
            <>
              <div className="billing-meter-label">
                <span>Recipes</span>
                <span>
                  <strong>{plan.saved}</strong> saved
                </span>
              </div>
              <p className="billing-usage-note">Unlimited recipe storage</p>
            </>
          ) : (
            <UsageMeter
              label="Recipes"
              value={plan.saved}
              limit={plan.recipes}
            />
          )}
        </div>
        <div className="billing-usage-item">
          <UsageMeter
            label="AI credits"
            value={remaining}
            limit={plan.credits}
            remaining
          />
          <p className="billing-usage-note">
            {plan.bucket === "free"
              ? "One-time allowance"
              : plan.bucket === "trial"
                ? "Trial allowance"
                : creditsResetAt
                  ? `Resets ${formatDate(creditsResetAt)}`
                  : "Monthly allowance"}
          </p>
        </div>
      </div>
      {(atRecipeLimit || remaining === 0 || ending) && (
        <div className="billing-notices">
          {atRecipeLimit && (
            <p>
              Recipe limit reached. Upgrade or remove recipes to save more. Your
              existing recipes are safe.
            </p>
          )}
          {remaining === 0 && (
            <p>
              {plan.bucket === "pro"
                ? "Monthly AI credits used up. You can still add recipes manually."
                : plan.bucket === "trial"
                  ? "Trial AI credits used up. Paid Pro includes monthly credits."
                  : atRecipeLimit
                    ? "Free AI credits used up. Pro includes monthly credits."
                    : "Free AI credits used up. Upgrade for monthly credits or add recipes manually."}
            </p>
          )}
          {ending && (
            <p>
              {plan.bucket === "trial" ? "Trial" : "Pro"} ends{" "}
              {formatDate(ending)}. Your recipes stay readable, editable and
              exportable.
            </p>
          )}
        </div>
      )}
      <div className="billing-overview-footer">{secondaryActions}</div>
      <details className="billing-comparison">
        <summary>
          Compare plans <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <table>
          <caption className="sr-only">Free and Pro plan allowances</caption>
          <thead>
            <tr>
              <td />
              <th scope="col">
                Free<span>A$0</span>
              </th>
              <th scope="col">
                Pro<span>A$4.99/month</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Recipes</th>
              <td>{plan.pricing.free.recipes} saved</td>
              <td>Unlimited</td>
            </tr>
            <tr>
              <th scope="row">AI credits</th>
              <td>{plan.pricing.free.aiCredits} total</td>
              <td>{plan.pricing.pro.aiCredits}/month</td>
            </tr>
            <tr>
              <th scope="row">Households</th>
              <td>Join</td>
              <td>Create &amp; join</td>
            </tr>
          </tbody>
        </table>
        {plan.pricing.trial.days > 0 && (
          <p className="billing-comparison-note">
            The {plan.pricing.trial.days}-day Pro trial includes{" "}
            {plan.pricing.trial.aiCredits} AI credits total.
          </p>
        )}
      </details>
    </div>
  );
}
