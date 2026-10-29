// Review this policy together with docs/provider-acceptance.md before changing it.
// Reservations are US cents, not measured provider invoices.
export const aiPolicy = {
  model: "gpt-6-luna",
  maxContentBytes: 160_000,
  maxSystemBytes: 160_000,
  // Up to five recipes per import.
  maxOutputTokens: 20_000,
  reserveCentsPerAttempt: 25,
  dailyBudgetCents: 2500,
};

// Reviewed 2026-10-19. Recheck official prices and account controls at acceptance.
// Include long-context and cache-write uplifts, plus schema/protocol allowance.
export function estimatedAttemptCents() {
  const inputTokens =
    aiPolicy.maxContentBytes + aiPolicy.maxSystemBytes + 16_384;
  return (
    (inputTokens * 0.1 * 2 * 1.25 + aiPolicy.maxOutputTokens * 0.5 * 1.5) /
    10_000
  );
}
