import { z } from "zod";

const optionalText = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() || undefined : value),
  z.string().optional(),
);

// Separate from provider configuration. Read at runtime, never during image build.
export function getSupportConfig(environment: NodeJS.ProcessEnv) {
  const production = environment.NODE_ENV === "production";
  const email = optionalText
    .pipe(z.email().optional())
    .parse(environment.SUPPORT_EMAIL);
  const operator = optionalText
    .pipe(z.string().min(3).max(120).optional())
    .parse(environment.SUPPORT_OPERATOR);
  if (production && (!email || !operator))
    throw new Error(
      "Production requires SUPPORT_EMAIL and SUPPORT_OPERATOR. See docs/account-support.md.",
    );
  return { email: email ?? null, operator: operator ?? null };
}
