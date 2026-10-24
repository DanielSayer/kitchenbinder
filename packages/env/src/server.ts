import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { validateProviderConfiguration } from "./providers";

export const providerConfiguration = validateProviderConfiguration(process.env);

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(10_000),
    DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    EXTENSION_IDS: z.string().optional(),
    DISCORD_CLIENT_ID: z.string().trim().optional(),
    DISCORD_CLIENT_SECRET: z.string().trim().optional(),
    GOOGLE_CLIENT_ID: z.string().trim().optional(),
    GOOGLE_CLIENT_SECRET: z.string().trim().optional(),
    OPENAI_API_KEY: z.string().trim().optional(),
    AI_ENABLED: z.enum(["true", "false"]).optional(),
    BILLING_MODE: z.enum(["disabled", "sandbox", "production"]).optional(),
    POLAR_ACCESS_TOKEN: z.string().trim().optional(),
    POLAR_WEBHOOK_SECRET: z.string().trim().optional(),
    POLAR_PRO_PRODUCT_ID: z.uuid().optional(),
    POLAR_SERVER: z.enum(["sandbox", "production"]).optional(),
    OPENAI_MODEL: z.string().trim().default(providerConfiguration.model),
    // S3-compatible bucket for recipe photos. Unset skips photo copying.
    MEDIA_BUCKET: z.string().trim().optional(),
    MEDIA_REGION: z.string().trim().optional(),
    // Only for non-AWS endpoints such as a local MinIO.
    MEDIA_ENDPOINT: z.url().optional(),
    MEDIA_ACCESS_KEY_ID: z.string().trim().optional(),
    MEDIA_SECRET_ACCESS_KEY: z.string().trim().optional(),
    // Public origin serving the bucket, e.g. the CDN distribution.
    MEDIA_PUBLIC_URL: z.url().optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  runtimeEnv: process.env,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
