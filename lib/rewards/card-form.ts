import { z } from "zod";
import { REWARD_CATEGORY_TAGS } from "./reward-categories";
import type { RewardTag } from "./config";
import type { BonusCap, CapPeriod, EarnRules } from "./rules";
import type { CardInput } from "@/lib/db/rewards-queries";

const pctSchema = z.coerce.number().min(0).max(100);
const pctToBps = (pct: number) => Math.round(pct * 100);
const TAGS = new Set<string>(REWARD_CATEGORY_TAGS);
const QUARTER = /^\d{4}-Q[1-4]$/;

/** A positive dollar amount in a form field, as cents (null when blank/invalid). */
function centsOpt(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

function periodOpt(v: FormDataEntryValue | null): CapPeriod {
  const s = String(v ?? "");
  return s === "year" || s === "month" ? s : "quarter";
}

const text = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

/**
 * Build earn rules from the card form. Category cards: baseRate plus
 * bonus_<tag> / cap_<tag> / capPeriod_<tag>. Rotating cards: baseRate,
 * bonusRate, rotCap / rotCapPeriod, and sched_<YYYY-Qn> (one entry per tag).
 */
function parseRules(formData: FormData): EarnRules | null {
  const base = pctSchema.safeParse(formData.get("baseRate"));
  if (!base.success) return null;
  const baseBps = pctToBps(base.data);

  if (formData.get("kind") === "rotating") {
    const bonus = pctSchema.safeParse(formData.get("bonusRate"));
    if (!bonus.success) return null;
    const schedule: Record<string, RewardTag[]> = {};
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("sched_")) continue;
      const quarter = key.slice("sched_".length);
      if (!QUARTER.test(quarter) || !TAGS.has(String(value))) continue;
      (schedule[quarter] ??= []).push(String(value) as RewardTag);
    }
    const capCents = centsOpt(formData.get("rotCap"));
    return {
      kind: "rotating",
      baseBps,
      bonusBps: pctToBps(bonus.data),
      schedule,
      ...(capCents ? { capCents, capPeriod: periodOpt(formData.get("rotCapPeriod")) } : {}),
    };
  }

  const bonuses: Partial<Record<RewardTag, number>> = {};
  const caps: Partial<Record<RewardTag, BonusCap>> = {};
  for (const tag of REWARD_CATEGORY_TAGS) {
    const raw = formData.get(`bonus_${tag}`);
    if (raw == null || String(raw).trim() === "") continue;
    const rate = pctSchema.safeParse(raw);
    if (!rate.success || rate.data <= 0) continue;
    bonuses[tag] = pctToBps(rate.data);
    const cap = centsOpt(formData.get(`cap_${tag}`));
    if (cap) caps[tag] = { cents: cap, period: periodOpt(formData.get(`capPeriod_${tag}`)) };
  }
  return { kind: "category", baseBps, bonuses, ...(Object.keys(caps).length ? { caps } : {}) };
}

/** Parse the Cards page form into a card (null when invalid). */
export function parseCardForm(formData: FormData): CardInput | null {
  const label = String(formData.get("label") ?? "").trim();
  const earnRules = parseRules(formData);
  if (!label || !earnRules) return null;
  return {
    label,
    accountId: text(formData.get("accountId")),
    earnRules,
    annualFeeCents: centsOpt(formData.get("annualFee")),
    signupBonus: text(formData.get("signupBonus")),
    notes: text(formData.get("notes")),
  };
}
