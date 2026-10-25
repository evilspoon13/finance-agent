import { z } from "zod";

/**
 * Centralized, validated access to environment variables, in three groups so
 * each part of the app only demands what it uses: core (DB + token key),
 * Plaid, and auth. Validated lazily, so unit tests and `next build` don't need
 * real credentials.
 */

const coreSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  TOKEN_ENC_KEY: z
    .string()
    .min(1, "TOKEN_ENC_KEY is required")
    .refine((v) => {
      try {
        return Buffer.from(v, "base64").length === 32;
      } catch {
        return false;
      }
    }, "TOKEN_ENC_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32)"),
  // Bearer token for /api/cron/sync (the scheduled daily sync). Unset = disabled.
  CRON_SECRET: z.string().min(16).optional().or(z.literal("")),
  // Scheduled finance agent (see docs/agent.md). Each is optional; the agent
  // endpoints answer 503 until AGENT_TOKEN and DATABASE_URL_READONLY are set.
  AGENT_TOKEN: z.string().min(32).optional().or(z.literal("")),
  DATABASE_URL_READONLY: z.string().optional(),
});

const plaidSchema = z.object({
  PLAID_CLIENT_ID: z.string().min(1, "PLAID_CLIENT_ID is required"),
  PLAID_SECRET: z.string().min(1, "PLAID_SECRET is required"),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  // Public URL of /api/plaid/webhook. Existing items are re-pointed here on sync.
  PLAID_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  // Registered OAuth redirect URI (required for OAuth institutions in
  // production). Must exactly match a URI allowlisted in the Plaid dashboard,
  // e.g. https://<your-app>/connections.
  PLAID_REDIRECT_URI: z.string().url().optional().or(z.literal("")),
});

const authSchema = z.object({
  AUTH_USERNAME: z.string().min(1, "AUTH_USERNAME is required"),
  AUTH_PASSWORD: z.string().min(12, "AUTH_PASSWORD must be at least 12 characters"),
  // Signs session cookies. Rotating it signs everyone out.
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)"),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type PlaidEnv = z.infer<typeof plaidSchema>;
export type AuthEnv = z.infer<typeof authSchema>;

function loader<T extends z.ZodTypeAny>(schema: T, what: string): () => z.infer<T> {
  let cached: z.infer<T> | null = null;
  return () => {
    if (cached) return cached;
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid ${what}:\n${parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")}`,
      );
    }
    cached = parsed.data;
    return cached;
  };
}

export const env = loader(coreSchema, "environment configuration");
export const plaidEnv = loader(plaidSchema, "Plaid configuration");
export const authEnv = loader(authSchema, "auth configuration");
