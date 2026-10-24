import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { BillingPlan } from "@/components/billing-plan";
import { ErrorNotice } from "@/components/feedback";
import { PricingFaq } from "@/components/plan-cards";
import { useTRPC } from "@/utils/trpc";

export function Billing() {
  const trpc = useTRPC();
  const client = useQueryClient();
  const status = useQuery(trpc.billing.status.queryOptions());
  const refresh = useMutation(
    trpc.billing.refresh.mutationOptions({
      onSuccess: () =>
        client.invalidateQueries({ queryKey: trpc.billing.status.queryKey() }),
    }),
  );
  const refreshed = useRef(false);
  useEffect(() => {
    if (status.data?.available && !refreshed.current) {
      refreshed.current = true;
      refresh.mutate();
    }
  }, [status.data?.available, refresh.mutate]);
  const redirect = ({ url }: { url: string }) => window.location.assign(url);
  const checkout = useMutation(
    trpc.billing.checkout.mutationOptions({ onSuccess: redirect }),
  );
  const portal = useMutation(
    trpc.billing.portal.mutationOptions({ onSuccess: redirect }),
  );
  const plan = status.data;
  const busy = checkout.isPending || portal.isPending || refresh.isPending;
  const manageSubscription = plan?.hasCustomer ? (
    <button
      type="button"
      className="button button-outline button-small"
      disabled={busy || !plan.available}
      onClick={() => portal.mutate()}
    >
      {portal.isPending ? "Opening billing..." : "Manage subscription"}
    </button>
  ) : null;
  return (
    <section className="billing-section" aria-label="Plan and usage">
      {status.isPending && <p role="status">Loading your plan...</p>}
      <ErrorNotice
        message={status.error?.message}
        retry={() => void status.refetch()}
      />
      {plan && (
        <>
          <BillingPlan
            plan={plan}
            action={
              plan.tier === "pro" ? (
                manageSubscription
              ) : (
                <button
                  type="button"
                  className="button button-primary button-small"
                  disabled={busy || !plan.available}
                  onClick={() => checkout.mutate()}
                >
                  {checkout.isPending
                    ? "Opening checkout..."
                    : !plan.available
                      ? "Pro is coming soon"
                      : plan.trialEligible && plan.pricing.trial.days > 0
                        ? `Start ${plan.pricing.trial.days}-day free trial`
                        : "Upgrade to Pro"}
                </button>
              )
            }
            secondaryActions={
              <>
                {plan.tier === "free" && manageSubscription}
                {plan.available && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => refresh.mutate()}
                  >
                    {refresh.isPending ? "Checking plan..." : "Refresh plan"}
                  </button>
                )}
              </>
            }
          />
          <PricingFaq heading="Plan details" />
        </>
      )}
      <ErrorNotice
        message={
          checkout.error?.message ??
          portal.error?.message ??
          refresh.error?.message
        }
      />
    </section>
  );
}
