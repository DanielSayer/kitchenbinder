import { WebhookCustomerStateChangedPayload$inboundSchema } from "@polar-sh/sdk/models/components/webhookcustomerstatechangedpayload";
import { WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import {
  WebhookVerificationError as SignatureError,
  Webhook,
} from "standardwebhooks";
import { z } from "zod";

// Polar's pre-2026-09-08 keys use the whole secret as UTF-8 HMAC bytes.
// New keys use Standard Webhooks' whsec_ base64 encoding. SDK 0.49 only
// handles the former. Keep both through rotation without weakening verification.
// https://polar.sh/docs/integrate/webhooks/delivery
export function validatePolarEvent(
  body: string,
  headers: Record<string, string>,
  secret: string,
) {
  const keys = [Buffer.from(secret, "utf8").toString("base64")];
  if (secret.startsWith("whsec_")) keys.push(secret);
  for (const key of keys) {
    let payload: unknown;
    try {
      payload = new Webhook(key).verify(body, headers);
    } catch (error) {
      if (error instanceof SignatureError) continue;
      throw error;
    }
    const { type } = z.object({ type: z.string() }).parse(payload);
    // No other event can grant access. Verify signatures before acknowledging it.
    if (type !== "customer.state_changed") return { type: "ignored" } as const;
    return WebhookCustomerStateChangedPayload$inboundSchema.parse(payload);
  }
  throw new WebhookVerificationError("Invalid webhook signature");
}
