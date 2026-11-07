import { z } from "zod";

/**
 * The numbers and rules the app can't see in the accounts, as JSON in
 * agent_context key "profile" (edited in Settings). Lives in the DB so nothing
 * personal is in the repo. Every field is optional: without it, the computed
 * view that needs it is reported as null rather than guessed.
 */
export const PROFILE_KEY = "profile";

const usd = z.number().nonnegative();

export const profileSchema = z.object({
  age: z.number().int().positive().optional(),
  retirementAge: z.number().int().positive().optional(), // for Coast FI
  grossPerCheckUsd: usd.optional(),
  hsaPerCheckUsd: usd.default(0), // payroll HSA: never visible in the bank data
  checksPerYear: z.number().int().positive().default(26),
  fiAnnualSpendUsd: usd.optional(), // unset = use the spending run rate
  excludedMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)).default([]), // unusual months, left out of run rates
  plannedAnnualRsuNetUsd: usd.default(0),
  plannedAnnualBonusNetUsd: usd.default(0),
  checkingBufferUsd: usd.default(500), // lowest balance a checking account should reach
  auditIgnoreMerchants: z.array(z.string()).default([]),
  stocks: z
    .object({
      sleevePct: z.number().min(0).max(100).default(10), // individual stocks, share of investable assets
      perNamePct: z.number().min(0).max(100).default(3),
      benchmark: z.string().default("VOO"),
      coreTickers: z.array(z.string()).default([]), // funds; anything else held counts toward the sleeve
      excludedTickers: z.array(z.string()).default([]), // never propose buying these
      higherBarSectors: z.array(z.string()).default([]), // proposals here must justify the added exposure
    })
    .prefault({}),
});

export type Profile = z.infer<typeof profileSchema>;

/** Parse the stored JSON. Bad or missing JSON gives the defaults, never an error in a run. */
export function parseProfile(raw: string | null): Profile {
  if (raw) {
    try {
      const parsed = profileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    } catch {
      // fall through to the defaults
    }
  }
  return profileSchema.parse({});
}
