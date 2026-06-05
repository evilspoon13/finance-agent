import { ai, aiModel } from "./client";
import { spendingByCategory, spendingByMonth } from "@/lib/db/analytics";
import { BUDGETABLE_CATEGORIES, humanizeCategory } from "@/lib/category";
import { formatCents } from "@/lib/money";

/**
 * AI budget advisor. We deterministically compute each budgetable category's
 * recent average monthly spend (the grounding facts), then ask the local model
 * to allocate a suggested monthly limit per category against the user's stated
 * income, leaving room for savings. The model only allocates real, computed
 * averages — every figure shown is verifiable, and the user reviews/edits the
 * suggestion before it is applied. If the model output can't be parsed, we fall
 * back to a deterministic allocation so the feature never hard-fails.
 */

type BudgetableCategory = (typeof BUDGETABLE_CATEGORIES)[number];

export interface BudgetSuggestion {
  category: BudgetableCategory;
  humanName: string;
  avgMonthlyCents: number; // computed: recent average monthly spend
  limitCents: number; // proposed monthly limit
  rationale: string;
}

export interface BudgetPlan {
  incomeCents: number;
  monthsAnalyzed: number;
  totalAvgMonthlyCents: number;
  totalSuggestedCents: number;
  monthlySavingsCents: number;
  summary: string;
  suggestions: BudgetSuggestion[];
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthsAgo(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() - n, 1);
}

/** Average monthly spend per budgetable category over the last 3 full months. */
async function computeAverages(now: Date): Promise<{
  months: number;
  avgByCat: Map<BudgetableCategory, number>;
}> {
  const to = startOfMonth(now); // exclude the current partial month
  const from = monthsAgo(now, 3);

  const [byCat, byMonth] = await Promise.all([
    spendingByCategory({ from, to }),
    spendingByMonth({ from, to }),
  ]);

  // Divide by the number of months that actually have data (1..3) so a short
  // history doesn't deflate the averages.
  const months = Math.min(3, Math.max(1, byMonth.length));

  const budgetable = new Set<string>(BUDGETABLE_CATEGORIES);
  const avgByCat = new Map<BudgetableCategory, number>();
  for (const row of byCat) {
    if (!budgetable.has(row.category)) continue;
    avgByCat.set(row.category as BudgetableCategory, Math.round(row.totalCents / months));
  }
  return { months, avgByCat };
}

const SYSTEM_PROMPT = `You are a pragmatic personal-finance budgeting assistant.
You receive the user's monthly take-home income and their recent AVERAGE monthly spend per category (in cents). Propose a sensible monthly budget limit (in cents) for each category.

RULES:
- Anchor each limit to the user's actual average for that category. Trim categories that look high; you may keep essentials (rent/utilities) near their average.
- The sum of all limits MUST be less than income, leaving a reasonable savings buffer (aim ~15-25% of income saved unless the note says otherwise).
- Use whole-dollar (multiples of 100 cents) limits.
- Keep each rationale to at most 12 words.
- Output ONLY JSON, no prose, in exactly this shape:
{"suggestions":[{"category":"FOOD_AND_DRINK","limitCents":30000,"rationale":"..."}],"summary":"one short sentence"}
- "category" MUST be one of the provided category codes. Do not invent categories.`;

interface RawSuggestion {
  category?: unknown;
  limitCents?: unknown;
  rationale?: unknown;
}

function coerceLimit(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Deterministic allocation used as a fallback (and when income is tight). */
function fallbackPlan(
  incomeCents: number,
  months: number,
  avgByCat: Map<BudgetableCategory, number>,
): BudgetPlan {
  const entries = [...avgByCat.entries()].filter(([, v]) => v > 0);
  const totalAvg = entries.reduce((s, [, v]) => s + v, 0);
  const target = Math.round(incomeCents * 0.8); // leave ~20% for savings
  const scale = totalAvg > target && totalAvg > 0 ? target / totalAvg : 1;

  const suggestions: BudgetSuggestion[] = entries.map(([category, avg]) => {
    const limitCents = Math.max(100, Math.round((avg * scale) / 100) * 100);
    return {
      category,
      humanName: humanizeCategory(category),
      avgMonthlyCents: avg,
      limitCents,
      rationale: scale < 1 ? "Trimmed proportionally to fit income." : "Set to your recent average.",
    };
  });

  return finalizePlan(incomeCents, months, totalAvg, suggestions, "Budget derived from your recent averages.");
}

function finalizePlan(
  incomeCents: number,
  months: number,
  totalAvgMonthlyCents: number,
  suggestions: BudgetSuggestion[],
  summary: string,
): BudgetPlan {
  const totalSuggestedCents = suggestions.reduce((s, x) => s + x.limitCents, 0);
  return {
    incomeCents,
    monthsAnalyzed: months,
    totalAvgMonthlyCents,
    totalSuggestedCents,
    monthlySavingsCents: incomeCents - totalSuggestedCents,
    summary,
    suggestions: suggestions.sort((a, b) => b.limitCents - a.limitCents),
  };
}

export async function suggestBudget(
  incomeCents: number,
  note?: string,
  now = new Date(),
): Promise<BudgetPlan> {
  const { months, avgByCat } = await computeAverages(now);
  const totalAvg = [...avgByCat.values()].reduce((s, v) => s + v, 0);

  // No spending history to anchor to — return an empty plan rather than guess.
  if (avgByCat.size === 0) {
    return finalizePlan(incomeCents, months, 0, [], "No recent spending found to base a budget on.");
  }

  const factCategories = [...avgByCat.entries()].map(([category, avgMonthlyCents]) => ({
    category,
    name: humanizeCategory(category),
    avgMonthlyCents,
    avg: formatCents(avgMonthlyCents),
  }));

  const userContent = `Monthly take-home income: ${incomeCents} cents (${formatCents(incomeCents)}).
Months of history analyzed: ${months}.
Recent average monthly spend by category:
${JSON.stringify(factCategories, null, 2)}
${note ? `\nUser preference: ${note}` : ""}

Allowed category codes: ${factCategories.map((c) => c.category).join(", ")}.
Return the budget JSON.`;

  let parsed: { suggestions?: RawSuggestion[]; summary?: unknown } | null = null;
  try {
    const completion = await ai().chat.completions.create({
      model: aiModel(),
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (!parsed || !Array.isArray(parsed.suggestions)) {
    return fallbackPlan(incomeCents, months, avgByCat);
  }

  // Validate + merge against the computed averages. Only trust categories the
  // model returned that are real budgetable codes with a sane limit.
  const seen = new Set<BudgetableCategory>();
  const suggestions: BudgetSuggestion[] = [];
  for (const s of parsed.suggestions) {
    const category = s.category as BudgetableCategory;
    if (!avgByCat.has(category) || seen.has(category)) continue;
    const limit = coerceLimit(s.limitCents);
    if (limit === null) continue;
    seen.add(category);
    suggestions.push({
      category,
      humanName: humanizeCategory(category),
      avgMonthlyCents: avgByCat.get(category) ?? 0,
      limitCents: limit,
      rationale: typeof s.rationale === "string" ? s.rationale.slice(0, 120) : "",
    });
  }

  // Fill in any budgetable category the model skipped, using its average.
  for (const [category, avg] of avgByCat) {
    if (seen.has(category) || avg <= 0) continue;
    suggestions.push({
      category,
      humanName: humanizeCategory(category),
      avgMonthlyCents: avg,
      limitCents: Math.max(100, Math.round(avg / 100) * 100),
      rationale: "Set to your recent average.",
    });
  }

  if (suggestions.length === 0) return fallbackPlan(incomeCents, months, avgByCat);

  const summary = typeof parsed.summary === "string" ? parsed.summary : "Suggested budget based on your recent spending.";
  return finalizePlan(incomeCents, months, totalAvg, suggestions, summary);
}
