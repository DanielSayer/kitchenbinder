import { HTTPClient, Polar } from "@polar-sh/sdk";
import { PolarError } from "@polar-sh/sdk/models/errors/polarerror";
import { WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { db } from "@prep-sheet/db";
import { user } from "@prep-sheet/db/schema/auth";
import { billingAccount } from "@prep-sheet/db/schema/billing";
import { env, providerConfiguration } from "@prep-sheet/env/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { Database } from "../households/access";
import { allowance, pricing } from "./policy";
import { lockAccount } from "./usage";
import { validatePolarEvent as validateEvent } from "./webhook";

export function billingEnabled() {
  return Boolean(
    providerConfiguration.billingMode !== "disabled" &&
      env.POLAR_ACCESS_TOKEN &&
      env.POLAR_PRO_PRODUCT_ID &&
      env.POLAR_WEBHOOK_SECRET,
  );
}

function polar() {
  if (!billingEnabled())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Pro billing isn't available yet.",
    });
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER,
    timeoutMs: 10000,
    // Match SDK 0.49's schemas and the production webhook contract.
    httpClient: new HTTPClient().addHook("beforeRequest", (request) => {
      request.headers.set("Polar-Version", "2026-04");
    }),
  });
}

const returnUrl = () =>
  new URL("/settings?billing=1", env.BETTER_AUTH_URL).href;

// Always fetch authoritative state under the account lock. Replayed or out-of-order
// webhooks cannot restore an older subscription. Only the configured Pro product counts.
export async function syncBilling(tx: Database, userId: string) {
  await lockAccount(tx, userId);
  let state:
    | Awaited<ReturnType<Polar["customers"]["getStateExternal"]>>
    | undefined;
  try {
    state = await polar().customers.getStateExternal({ externalId: userId });
  } catch (error) {
    if (!(error instanceof PolarError) || error.statusCode !== 404) throw error;
  }
  const now = new Date();
  const subscription = state?.activeSubscriptions
    .filter(
      (s) =>
        s.productId === env.POLAR_PRO_PRODUCT_ID &&
        (s.status === "active" || s.status === "trialing") &&
        s.currentPeriodEnd > now,
    )
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime(),
    )[0];
  const [previous] = await tx
    .select()
    .from(billingAccount)
    .where(eq(billingAccount.userId, userId));
  const validUntil = subscription
    ? new Date(
        Math.min(
          subscription.currentPeriodEnd.getTime(),
          subscription.endsAt?.getTime() ?? Number.POSITIVE_INFINITY,
          subscription.status === "trialing"
            ? (subscription.trialEnd?.getTime() ??
                subscription.currentPeriodEnd.getTime())
            : Number.POSITIVE_INFINITY,
        ),
      )
    : null;
  const values = {
    userId,
    customerId: state?.id ?? previous?.customerId ?? null,
    status: subscription?.status ?? "free",
    validUntil,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    trialUsed: previous?.trialUsed === true || subscription !== undefined,
    syncedAt: now,
    ...(subscription ? { checkoutUrl: null, checkoutExpiresAt: null } : {}),
  };
  const [saved] = await tx
    .insert(billingAccount)
    .values(values)
    .onConflictDoUpdate({ target: billingAccount.userId, set: values })
    .returning();
  return saved;
}

// Commit reconciliation separately so a quota rejection cannot roll it back.
export async function refreshBillingIfStale(userId: string) {
  if (!billingEnabled()) return;
  await db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    const [account] = await tx
      .select()
      .from(billingAccount)
      .where(eq(billingAccount.userId, userId));
    if (
      !account ||
      (!account.customerId && !account.trialUsed && account.status === "free")
    )
      return;
    const now = new Date();
    if (allowance(account.status, account.validUntil, now).tier === "pro")
      return;
    // Recheck expired paid access immediately, but cache confirmed Free state.
    if (
      account.status === "free" &&
      account.syncedAt &&
      now.getTime() - account.syncedAt.getTime() < 60_000
    )
      return;
    try {
      await syncBilling(tx, userId);
    } catch (cause) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Couldn't verify your plan. Please try again shortly.",
        cause,
      });
    }
  });
}

export async function startCheckout(account: {
  id: string;
  email: string;
  name: string;
}) {
  return db.transaction(async (tx) => {
    const current = await syncBilling(tx, account.id);
    if (current?.customerId && (await hasUnfinishedSubscription(account.id)))
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "You have an existing subscription. Use Manage subscription to update or cancel it.",
      });
    if (
      allowance(current?.status ?? "free", current?.validUntil ?? null).tier ===
      "pro"
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "You already have Pro. Use Manage subscription.",
      });
    if (
      current?.checkoutUrl &&
      current.checkoutExpiresAt &&
      current.checkoutExpiresAt > new Date()
    )
      return { url: current.checkoutUrl };
    const productId = env.POLAR_PRO_PRODUCT_ID;
    if (!productId)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Pro billing isn't available yet.",
      });
    const checkout = await polar().checkouts.create({
      products: [productId],
      externalCustomerId: account.id,
      customerEmail: account.email,
      customerName: account.name,
      successUrl: returnUrl(),
      returnUrl: returnUrl(),
      allowDiscountCodes: true,
      allowTrial: !current?.trialUsed && pricing.trial.days > 0,
      trialInterval: "day",
      trialIntervalCount: Math.max(1, pricing.trial.days),
    });
    await tx
      .update(billingAccount)
      // Reserve the trial once, including when the checkout is abandoned.
      .set({
        checkoutUrl: checkout.url,
        checkoutExpiresAt: checkout.expiresAt,
        trialUsed: true,
      })
      .where(eq(billingAccount.userId, account.id));
    return { url: checkout.url };
  });
}

export async function customerPortal(userId: string) {
  const session = await polar().customerSessions.create({
    externalCustomerId: userId,
    returnUrl: returnUrl(),
  });
  return { url: session.customerPortalUrl };
}

export async function hasUnfinishedSubscription(userId: string) {
  const pages = await polar().subscriptions.list({
    externalCustomerId: userId,
    limit: 100,
  });
  for await (const page of pages) {
    if (
      page.result.items.some(
        (subscription) =>
          subscription.status !== "canceled" &&
          subscription.status !== "incomplete_expired",
      )
    )
      return true;
  }
  return false;
}

export async function handlePolarWebhook(request: Request): Promise<Response> {
  if (!billingEnabled() || !env.POLAR_WEBHOOK_SECRET)
    return new Response("Billing unavailable", { status: 503 });
  let event: ReturnType<typeof validateEvent>;
  try {
    event = validateEvent(
      await request.text(),
      Object.fromEntries(request.headers),
      env.POLAR_WEBHOOK_SECRET,
    );
  } catch (error) {
    return new Response("Invalid webhook", {
      status: error instanceof WebhookVerificationError ? 403 : 400,
    });
  }
  if (event.type !== "customer.state_changed") return new Response("Ignored");
  const userId = event.data.externalId;
  if (!userId) return new Response("Ignored");
  try {
    await db.transaction(async (tx) => {
      const [account] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("update");
      if (account) await syncBilling(tx, userId);
    });
    return new Response("OK");
  } catch {
    // Polar retries failures; never acknowledge a failed database write or API read.
    return new Response("Billing sync failed", { status: 503 });
  }
}
