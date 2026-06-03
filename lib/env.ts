import { z } from "zod";

/**
 * Centralized, validated access to environment variables.
 *
 * Core vars (DATABASE_URL, TOKEN_ENC_KEY) are required for the app to boot.
 * Plaid vars are validated lazily via `plaidEnv()` so the dashboard shell and
 * unit tests can run without real Plaid credentials.
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
  APP_OWNER_NAME: z.string().default("Owner"),
});

const plaidSchema = z.object({
  PLAID_CLIENT_ID: z.string().min(1, "PLAID_CLIENT_ID is required"),
  PLAID_SECRET: z.string().min(1, "PLAID_SECRET is required"),
  PLAID_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  PLAID_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
});

export type CoreEnv = z.infer<typeof coreSchema>;
export type PlaidEnv = z.infer<typeof plaidSchema>;

let _core: CoreEnv | null = null;
let _plaid: PlaidEnv | null = null;

export function env(): CoreEnv {
  if (_core) return _core;
  const parsed = coreSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  _core = parsed.data;
  return _core;
}

export function plaidEnv(): PlaidEnv {
  if (_plaid) return _plaid;
  const parsed = plaidSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid Plaid configuration:\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  _plaid = parsed.data;
  return _plaid;
}
