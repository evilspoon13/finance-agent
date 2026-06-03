import { ai, aiModel } from "./client";
import { spendingDrilldown, type SpendingFilter } from "@/lib/db/analytics";
import { budgetProgress } from "@/lib/db/budget-queries";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

/**
 * Grounded AI insights. We compute every number deterministically and pass
 * them to the model as facts; the model only phrases them. The prompt forbids
 * inventing figures, so a small local model can't fabricate dollar amounts.
 */

export interface InsightFacts {
  range: string;
  totalSpending: string;
  topCategories: { name: string; amount: string; pct: number; trend: string | null }[];
  budgetAlerts: { name: string; spent: string; limit: string; pct: number }[];
}

function rangeLabel(f: SpendingFilter): string {
  if (!f.from && !f.to) return "all time";
  const from = f.from ? f.from.toISOString().slice(0, 10) : "earliest";
  const to = f.to ? f.to.toISOString().slice(0, 10) : "today";
  return `${from} to ${to}`;
}

export async function buildInsightFacts(f: SpendingFilter): Promise<InsightFacts> {
  const [drill, budgets] = await Promise.all([spendingDrilldown(f), budgetProgress()]);
  return {
    range: rangeLabel(f),
    totalSpending: formatCents(drill.totalCents),
    topCategories: drill.categories.slice(0, 6).map((c) => ({
      name: humanizeCategory(c.category),
      amount: formatCents(c.totalCents),
      pct: c.pct,
      trend: c.trendPct === null ? null : `${c.trendPct > 0 ? "+" : ""}${c.trendPct}% vs prior period`,
    })),
    budgetAlerts: budgets
      .filter((b) => b.pct >= 80)
      .map((b) => ({
        name: humanizeCategory(b.category),
        spent: formatCents(b.spentCents),
        limit: formatCents(b.monthlyLimitCents),
        pct: b.pct,
      })),
  };
}

const SYSTEM_PROMPT = `You are a concise personal-finance assistant.
You will be given a JSON object of pre-computed spending facts.
Rules:
- Only use numbers that appear in the facts. NEVER invent or estimate figures.
- Write 2-4 short sentences of plain, useful observations (largest categories, notable trends, budget risk).
- No preamble, no markdown headers, no bullet lists. Just the summary.`;

export async function generateInsight(f: SpendingFilter): Promise<string> {
  const facts = await buildInsightFacts(f);
  const completion = await ai().chat.completions.create({
    model: aiModel(),
    temperature: 0.3,
    max_tokens: 300,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Spending facts (range: ${facts.range}):\n${JSON.stringify(facts, null, 2)}\n\nWrite the summary.`,
      },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "No insight generated.";
}
