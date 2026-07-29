import { chatCompletion, aiModel } from "./client";
import { dollarsToCents } from "@/lib/money";
import { REWARD_CATEGORIES, REWARD_CATEGORY_TAGS } from "@/lib/rewards/reward-categories";
import { DISCOVER_CAP_CENTS } from "@/lib/rewards/config";
import type { RewardTag } from "@/lib/rewards/config";
import type { CapPeriod, EarnRules } from "@/lib/rewards/catalog";

/**
 * AI card-rewards lookup. Given a card name, the model recalls its rewards
 * structure from training knowledge and returns it as structured JSON mapped to
 * our reward tags. This is a SUGGESTION — the user must confirm it on the Cards
 * page before it counts (see confirmCard). Card terms change and the model can
 * be wrong, so we surface confidence + notes and never apply without confirm.
 */

export interface SuggestedBonus {
  category: RewardTag;
  ratePct: number;
  capAmount?: number | null; // dollars of bonus-eligible spend per period
  capPeriod?: CapPeriod | null;
}

export interface SuggestedRotating {
  bonusRatePct: number;
  capAmount?: number | null;
  capPeriod?: CapPeriod | null;
  quarters: { quarter: string; categories: RewardTag[] }[];
}

export interface CardRewardSuggestion {
  currency: "cashback" | "points" | "miles";
  baseRatePct: number;
  bonuses: SuggestedBonus[];
  rotating: SuggestedRotating | null;
  annualFee: number | null; // dollars
  signupBonus: string | null;
  cashbackMatchYearOne: boolean;
  notes: string;
  confidence: "high" | "medium" | "low";
}

const TAG_SET = new Set<RewardTag>(REWARD_CATEGORY_TAGS);
const CAP_PERIODS = new Set<CapPeriod>(["year", "quarter", "month"]);

const SYSTEM_PROMPT = `You are a credit-card rewards expert. Given a card's name, return its CURRENT rewards structure as JSON. Use ONLY your knowledge; if unsure about a detail, lower "confidence" and explain in "notes".

You MUST map every bonus to one of these reward category tags (ignore rewards that don't fit any tag):
${REWARD_CATEGORIES.map((c) => `- ${c.tag}: ${c.label}`).join("\n")}

Express ALL rates as a cash-back-equivalent PERCENT (a 3x points or 3 miles/$ card ≈ 3.0; if points/miles, set currency accordingly and note the valuation assumption).

Return ONLY this JSON shape:
{
  "currency": "cashback" | "points" | "miles",
  "baseRatePct": number,                       // rate on everything else
  "bonuses": [                                 // FIXED category bonuses (not rotating)
    { "category": <tag>, "ratePct": number, "capAmount": number|null, "capPeriod": "year"|"quarter"|"month"|null }
  ],
  "rotating": null | {                         // for Discover it / Freedom Flex style cards
    "bonusRatePct": number,
    "capAmount": number|null, "capPeriod": "quarter",
    "quarters": [ { "quarter": "YYYY-Qn", "categories": [<tag>, ...] } ]   // only quarters you actually know
  },
  "annualFee": number|null,                    // dollars
  "signupBonus": string|null,                  // short text, e.g. "$200 after $500 in 3 months"
  "cashbackMatchYearOne": boolean,             // true only for Discover first-year Cashback Match
  "notes": string,                             // caveats / assumptions, 1-2 sentences
  "confidence": "high" | "medium" | "low"
}
capAmount is the dollars of bonus-eligible spend per period (e.g. 6% groceries up to $6000/year -> capAmount 6000, capPeriod "year"). Use null when uncapped. Only include rotating quarters you are confident were announced.`;

function clampPct(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 100);
}

// Fuzzy keyword -> tag, since the model often returns free-text labels
// ("Grocery stores", "Restaurants", "Gas stations") instead of our exact tags.
const TAG_KEYWORDS: [string, RewardTag][] = [
  ["grocer", "grocery"],
  ["supermarket", "grocery"],
  ["restaurant", "dining"],
  ["dining", "dining"],
  ["wholesale", "wholesale_club"],
  ["warehouse club", "wholesale_club"],
  ["stream", "streaming"],
  ["gas", "gas"],
  ["fuel", "gas"],
  ["ev charg", "ev_charging"],
  ["charging station", "ev_charging"],
  ["transit", "transit"],
  ["public transport", "transit"],
  ["flight", "flights"],
  ["airline", "flights"],
  ["airfare", "flights"],
  ["hotel", "hotel"],
  ["lodging", "hotel"],
  ["drug", "drugstore"],
  ["pharmac", "drugstore"],
  ["home improvement", "home_improvement"],
  ["hardware", "home_improvement"],
];

/** Map a tag or a free-text category label to one of our reward tags, or null. */
function coerceTag(v: unknown): RewardTag | null {
  if (typeof v !== "string") return null;
  if (TAG_SET.has(v as RewardTag)) return v as RewardTag;
  const s = v.toLowerCase();
  for (const [kw, tag] of TAG_KEYWORDS) if (s.includes(kw)) return tag;
  return null;
}

/** Normalize a quarter label ("2026-Q1", "Q1 2026", "2026Q1") to "YYYY-Qn". */
function normQuarter(v: unknown): string | null {
  const s = String(v ?? "").toUpperCase().replace(/\s+/g, "");
  const m = /(\d{4})-?Q([1-4])/.exec(s) ?? /Q([1-4])-?(\d{4})/.exec(s);
  if (!m) return null;
  const [year, q] = /^\d{4}/.test(m[1]!) ? [m[1], m[2]] : [m[2], m[1]];
  return `${year}-Q${q}`;
}

function validPeriod(v: unknown): CapPeriod | null {
  return typeof v === "string" && CAP_PERIODS.has(v as CapPeriod) ? (v as CapPeriod) : null;
}

function posAmount(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Coerce arbitrary model output into a safe CardRewardSuggestion. */
function sanitize(raw: unknown): CardRewardSuggestion {
  const o = (raw ?? {}) as Record<string, unknown>;

  const bonuses: SuggestedBonus[] = [];
  if (Array.isArray(o.bonuses)) {
    const seen = new Set<RewardTag>();
    for (const b of o.bonuses as Record<string, unknown>[]) {
      const category = coerceTag(b?.category);
      const ratePct = clampPct(b?.ratePct);
      if (!category || seen.has(category) || ratePct <= 0) continue;
      seen.add(category);
      bonuses.push({
        category,
        ratePct,
        capAmount: posAmount(b?.capAmount),
        capPeriod: validPeriod(b?.capPeriod),
      });
    }
  }

  let rotating: SuggestedRotating | null = null;
  const r = o.rotating as Record<string, unknown> | null | undefined;
  if (r && typeof r === "object" && clampPct(r.bonusRatePct) > 0) {
    const quarters = (Array.isArray(r.quarters) ? (r.quarters as Record<string, unknown>[]) : [])
      .map((q) => {
        const quarter = normQuarter(q?.quarter);
        const categories = Array.isArray(q?.categories)
          ? [...new Set(q.categories.map(coerceTag).filter((t): t is RewardTag => t !== null))]
          : [];
        return quarter ? { quarter, categories } : null;
      })
      // Keep only quarters that mapped to at least one detectable reward tag.
      .filter((q): q is { quarter: string; categories: RewardTag[] } => q !== null && q.categories.length > 0);
    rotating = {
      bonusRatePct: clampPct(r.bonusRatePct),
      capAmount: posAmount(r.capAmount),
      capPeriod: "quarter",
      quarters,
    };
  }

  const currency = ["cashback", "points", "miles"].includes(o.currency as string)
    ? (o.currency as CardRewardSuggestion["currency"])
    : "cashback";
  const confidence = ["high", "medium", "low"].includes(o.confidence as string)
    ? (o.confidence as CardRewardSuggestion["confidence"])
    : "low";

  return {
    currency,
    baseRatePct: clampPct(o.baseRatePct) || 1,
    bonuses,
    rotating,
    annualFee: posAmount(o.annualFee),
    signupBonus: typeof o.signupBonus === "string" && o.signupBonus.trim() ? o.signupBonus.trim() : null,
    cashbackMatchYearOne: o.cashbackMatchYearOne === true,
    notes: typeof o.notes === "string" ? o.notes : "",
    confidence,
  };
}

const FALLBACK: CardRewardSuggestion = {
  currency: "cashback",
  baseRatePct: 1,
  bonuses: [],
  rotating: null,
  annualFee: null,
  signupBonus: null,
  cashbackMatchYearOne: false,
  notes: "Couldn't look up this card automatically — defaulting to a flat 1%. Please edit the rewards.",
  confidence: "low",
};

/** Ask the model for a card's rewards structure (always returns a safe object). */
export async function lookupCardRewards(cardName: string): Promise<CardRewardSuggestion> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const completion = await chatCompletion({
      model: aiModel(),
      temperature: 0.2,
      // Generous cap: a full rotating calendar + several bonuses can be long,
      // and a truncated response fails JSON.parse and falls back to a flat 1%.
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Today is ${today}. Card: "${cardName}". Return the rewards JSON.` },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return FALLBACK;
    return sanitize(JSON.parse(raw));
  } catch {
    return FALLBACK;
  }
}

const pctToBps = (pct: number) => Math.round(pct * 100);

export interface ConfirmedRewards {
  earnRules: EarnRules;
  annualFeeCents: number | null;
  signupBonus: string | null;
  notes: string;
  cashbackMatchYearOne: boolean;
}

/**
 * Map a suggestion to engine-ready EarnRules + display info. Rotating cards
 * become a `rotating` rule (their fixed bonuses, if any, are noted but not
 * modeled); everything else becomes a `category` rule with optional caps.
 */
export function suggestionToEarnRules(s: CardRewardSuggestion): ConfirmedRewards {
  let earnRules: EarnRules;

  if (s.rotating) {
    earnRules = {
      kind: "rotating",
      currency: "cashback",
      bonusBps: pctToBps(s.rotating.bonusRatePct),
      baseBps: pctToBps(s.baseRatePct),
      schedule: Object.fromEntries(s.rotating.quarters.map((q) => [q.quarter, q.categories])),
      capCents: s.rotating.capAmount ? dollarsToCents(s.rotating.capAmount) : DISCOVER_CAP_CENTS,
      capPeriod: "quarter",
    };
  } else {
    const bonuses: Partial<Record<RewardTag, number>> = {};
    const caps: Partial<Record<RewardTag, { cents: number; period: CapPeriod }>> = {};
    for (const b of s.bonuses) {
      bonuses[b.category] = pctToBps(b.ratePct);
      if (b.capAmount && b.capPeriod) {
        caps[b.category] = { cents: dollarsToCents(b.capAmount), period: b.capPeriod };
      }
    }
    earnRules = {
      kind: "category",
      currency: "cashback",
      baseBps: pctToBps(s.baseRatePct),
      bonuses,
      ...(Object.keys(caps).length ? { caps } : {}),
    };
  }

  return {
    earnRules,
    annualFeeCents: s.annualFee != null ? dollarsToCents(s.annualFee) : null,
    signupBonus: s.signupBonus,
    notes: s.notes,
    cashbackMatchYearOne: s.cashbackMatchYearOne,
  };
}
