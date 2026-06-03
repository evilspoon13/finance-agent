import { ai, aiModel } from "./client";
import {
  spendingDrilldown,
  spendingByMonth,
  spendingFingerprint,
  listTransactions,
  type SpendingFilter,
} from "@/lib/db/analytics";
import { budgetProgress } from "@/lib/db/budget-queries";
import { getAiCache, setAiCache } from "@/lib/db/ai-cache";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

/**
 * Grounded AI insights. Every number is computed deterministically and passed
 * to the model as facts; the model only phrases them. Results are cached per
 * scope and reused until the underlying spending changes (fingerprint).
 */

export interface InsightFacts {
  range: string;
  totalSpending: string;
  monthlyTotals: { month: string; amount: string }[];
  categories: {
    name: string;
    amount: string;
    pct: number;
    count: number;
    trend: string | null;
    topMerchants: { name: string; amount: string; count: number }[];
    topSubcategories: { name: string; amount: string }[];
  }[];
  largestTransactions: { date: string; merchant: string; amount: string; category: string }[];
  budgets: {
    name: string;
    spent: string;
    limit: string;
    pct: number;
    daysLeft: number;
    status: "ok" | "warning" | "over";
  }[];
}

function rangeLabel(f: SpendingFilter): string {
  if (!f.from && !f.to) return "all time";
  const from = f.from ? f.from.toISOString().slice(0, 10) : "earliest";
  const to = f.to ? f.to.toISOString().slice(0, 10) : "today";
  return `${from} to ${to}`;
}

function detailedLabel(detailed: string, primary: string): string {
  const tail = detailed.startsWith(`${primary}_`) ? detailed.slice(primary.length + 1) : detailed;
  return humanizeCategory(tail);
}

export async function buildInsightFacts(f: SpendingFilter): Promise<InsightFacts> {
  const [drill, months, budgets, largest] = await Promise.all([
    spendingDrilldown(f, 3),
    spendingByMonth(f),
    budgetProgress(),
    listTransactions({ from: f.from, to: f.to, accountId: f.accountId, limit: 8 }),
  ]);

  // Largest purchases in range (outflows), by amount.
  const largestPurchases = [...largest]
    .filter((t) => t.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 6);

  return {
    range: rangeLabel(f),
    totalSpending: formatCents(drill.totalCents),
    monthlyTotals: months.map((m) => ({ month: m.month, amount: formatCents(m.totalCents) })),
    categories: drill.categories.map((c) => ({
      name: humanizeCategory(c.category),
      amount: formatCents(c.totalCents),
      pct: c.pct,
      count: c.count,
      trend: c.trendPct === null ? null : `${c.trendPct > 0 ? "+" : ""}${c.trendPct}% vs prior period`,
      topMerchants: c.topMerchants.map((m) => ({
        name: m.merchant,
        amount: formatCents(m.totalCents),
        count: m.count,
      })),
      topSubcategories: c.detailed
        .slice(0, 3)
        .map((d) => ({ name: detailedLabel(d.detailed, c.category), amount: formatCents(d.totalCents) })),
    })),
    largestTransactions: largestPurchases.map((t) => ({
      date: t.postedAt ? t.postedAt.toISOString().slice(0, 10) : "—",
      merchant: t.merchantName ?? t.name,
      amount: formatCents(t.amountCents),
      category: humanizeCategory(t.category),
    })),
    budgets: budgets.map((b) => ({
      name: humanizeCategory(b.category),
      spent: formatCents(b.spentCents),
      limit: formatCents(b.monthlyLimitCents),
      pct: b.pct,
      daysLeft: b.daysRemaining,
      status: b.spentCents > b.monthlyLimitCents ? "over" : b.pct >= 80 ? "warning" : "ok",
    })),
  };
}

const SYSTEM_PROMPT = `You are a sharp, concise personal-finance analyst.
You receive a JSON object of pre-computed spending facts. Write an in-depth but tight analysis.

HARD RULES:
- Use ONLY numbers present in the facts. NEVER invent, estimate, or do arithmetic that produces a new figure.
- If a comparison isn't in the facts, don't make it.

Structure the response in short labeled sections (plain text, no markdown tables):
- Overview: total spending and the 2-3 categories that dominate.
- Where it went: notable subcategories and specific top merchants worth calling out.
- Trends: categories rising or falling vs the prior period (use the provided trend strings).
- Budgets: any category at/over its limit, with days left.
- Watch-outs: 1-2 grounded, actionable observations (e.g. a large one-off purchase, or a category trending up fast).
Keep it scannable. No fluff, no generic advice.`;

export async function generateInsight(f: SpendingFilter): Promise<string> {
  const facts = await buildInsightFacts(f);
  const completion = await ai().chat.completions.create({
    model: aiModel(),
    temperature: 0.3,
    max_tokens: 700,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Spending facts (range: ${facts.range}):\n${JSON.stringify(facts, null, 2)}\n\nWrite the analysis.`,
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "No insight generated.";
}

function scopeKey(f: SpendingFilter): string {
  const from = f.from ? f.from.toISOString().slice(0, 10) : "";
  const to = f.to ? f.to.toISOString().slice(0, 10) : "";
  return `insight:${from}:${to}:${f.accountId ?? ""}`;
}

export interface InsightResult {
  text: string;
  cached: boolean;
  updatedAt: Date;
}

/**
 * Return a cached insight if the spending fingerprint and model are unchanged;
 * otherwise generate a fresh one and cache it. `force` bypasses the cache.
 */
export async function getInsight(f: SpendingFilter, force = false): Promise<InsightResult> {
  const scope = scopeKey(f);
  const fingerprint = await spendingFingerprint(f);
  const model = aiModel();

  if (!force) {
    const cached = await getAiCache(scope);
    if (cached && cached.fingerprint === fingerprint && cached.model === model) {
      return { text: cached.content, cached: true, updatedAt: cached.updatedAt };
    }
  }

  const text = await generateInsight(f);
  await setAiCache(scope, fingerprint, model, text);
  return { text, cached: false, updatedAt: new Date() };
}
