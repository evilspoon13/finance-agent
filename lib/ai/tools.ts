import { z } from "zod";
import {
  spendingByCategory,
  topMerchants,
  listTransactions,
  getNetWorth,
} from "@/lib/db/analytics";
import { budgetProgress } from "@/lib/db/budget-queries";
import { analyzeRewards, type RewardWindow } from "@/lib/rewards/compute";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";

/**
 * Whitelisted, read-only tools the Q&A agent may call. The model never writes
 * SQL — it calls these parameterized functions, whose args are zod-validated.
 * Results format money as dollar strings so answers stay grounded in real data.
 */

function parseDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

const dateRange = {
  from: z.string().optional().describe("start date YYYY-MM-DD"),
  to: z.string().optional().describe("end date YYYY-MM-DD"),
};

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema for the model
  schema: z.ZodTypeAny;
  run: (args: unknown) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: "get_spending_by_category",
    description:
      "Total spending grouped by category (Plaid pfc_primary code) for an optional date range. Use the returned category codes for other tools.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "start date YYYY-MM-DD" },
        to: { type: "string", description: "end date YYYY-MM-DD" },
      },
    },
    schema: z.object({ ...dateRange }),
    run: async (args) => {
      const a = z.object({ ...dateRange }).parse(args);
      const rows = await spendingByCategory({ from: parseDate(a.from), to: parseDate(a.to, true) });
      return rows.map((r) => ({
        category_code: r.category,
        category: humanizeCategory(r.category),
        total: formatCents(r.totalCents),
        transactions: r.count,
      }));
    },
  },
  {
    name: "get_top_merchants",
    description:
      "Top merchants by total spend, optionally within a category (pass the pfc_primary code) and/or date range.",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "pfc_primary code, e.g. FOOD_AND_DRINK" },
        from: { type: "string", description: "start date YYYY-MM-DD" },
        to: { type: "string", description: "end date YYYY-MM-DD" },
        limit: { type: "number", description: "max merchants (default 10)" },
      },
    },
    schema: z.object({ category: z.string().optional(), ...dateRange, limit: z.number().optional() }),
    run: async (args) => {
      const a = z
        .object({ category: z.string().optional(), ...dateRange, limit: z.number().optional() })
        .parse(args);
      const rows = await topMerchants(
        { category: a.category, from: parseDate(a.from), to: parseDate(a.to, true) },
        Math.min(a.limit ?? 10, 25),
      );
      return rows.map((r) => ({ merchant: r.merchant, total: formatCents(r.totalCents), visits: r.count }));
    },
  },
  {
    name: "get_transactions",
    description:
      "List individual transactions with optional filters (date range, category code, free-text search). Returns most recent first.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "start date YYYY-MM-DD" },
        to: { type: "string", description: "end date YYYY-MM-DD" },
        category: { type: "string", description: "pfc_primary code" },
        search: { type: "string", description: "merchant/name substring" },
        limit: { type: "number", description: "max rows (default 20)" },
      },
    },
    schema: z.object({
      ...dateRange,
      category: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    }),
    run: async (args) => {
      const a = z
        .object({ ...dateRange, category: z.string().optional(), search: z.string().optional(), limit: z.number().optional() })
        .parse(args);
      const rows = await listTransactions({
        from: parseDate(a.from),
        to: parseDate(a.to, true),
        category: a.category,
        search: a.search,
        limit: Math.min(a.limit ?? 20, 50),
      });
      return rows.map((t) => ({
        date: t.postedAt ? t.postedAt.toISOString().slice(0, 10) : null,
        merchant: t.merchantName ?? t.name,
        account: t.accountName,
        category: humanizeCategory(t.category),
        amount: formatCents(t.amountCents),
        pending: t.pending,
      }));
    },
  },
  {
    name: "get_budget_status",
    description: "Current-month budget progress: spent vs limit per category, percent used, days left.",
    parameters: { type: "object", properties: {} },
    schema: z.object({}),
    run: async () => {
      const rows = await budgetProgress();
      return rows.map((b) => ({
        category: humanizeCategory(b.category),
        spent: formatCents(b.spentCents),
        limit: formatCents(b.monthlyLimitCents),
        percent_used: b.pct,
        days_left: b.daysRemaining,
        over_budget: b.spentCents > b.monthlyLimitCents,
      }));
    },
  },
  {
    name: "get_net_worth",
    description: "Net worth: total assets, liabilities, and per-account values.",
    parameters: { type: "object", properties: {} },
    schema: z.object({}),
    run: async () => {
      const nw = await getNetWorth();
      return {
        net_worth: formatCents(nw.netWorthCents),
        assets: formatCents(nw.assetsCents),
        liabilities: formatCents(nw.liabilitiesCents),
        accounts: nw.lines.map((l) => ({ name: l.name, type: l.klass, value: formatCents(l.valueCents) })),
      };
    },
  },
  {
    name: "get_rewards_summary",
    description:
      "Credit-card rewards: value earned per card, total missed rewards, and the best card per category. window can be 'month', 'quarter', or 'all'.",
    parameters: {
      type: "object",
      properties: { window: { type: "string", enum: ["month", "quarter", "all"] } },
    },
    schema: z.object({ window: z.enum(["month", "quarter", "all"]).optional() }),
    run: async (args) => {
      const a = z.object({ window: z.enum(["month", "quarter", "all"]).optional() }).parse(args);
      let w: RewardWindow | undefined;
      const now = new Date();
      if (a.window === "month") w = { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) };
      else if (a.window === "quarter")
        w = { from: new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)) };
      const r = await analyzeRewards(w);
      return {
        earned_per_card: r.perCard.map((c) => ({ card: c.label, earned: formatCents(c.earnedCents), purchases: c.txnCount })),
        total_missed: formatCents(r.totalMissedCents),
        best_card_by_category: r.guide.map((g) => ({
          category: g.category === "everything else" ? "everything else" : humanizeCategory(g.category),
          card: g.bestLabel,
          rate: `${(g.effectiveBps / 100).toFixed(2)}%`,
        })),
      };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** OpenAI-style tool specs for the chat completion request. */
export function toolSpecs() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Validate args and execute a tool by name. */
export async function runTool(name: string, rawArgs: unknown): Promise<unknown> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    const args = tool.schema.parse(rawArgs ?? {});
    return await tool.run(args);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Tool execution failed" };
  }
}
