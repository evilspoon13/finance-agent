import { z } from "zod";
import {
  spendingByCategory,
  spendingTotal,
  topMerchants,
  listTransactions,
  getNetWorth,
} from "@/lib/db/analytics";
import { budgetProgress } from "@/lib/db/budget-queries";
import { analyzeRewards, type RewardWindow } from "@/lib/rewards/compute";
import { formatCents } from "@/lib/money";
import { humanizeCategory } from "@/lib/category";
import { resolveTopic, TOPIC_NAMES, type TopicScope } from "./topics";

/**
 * Whitelisted, read-only tools the Q&A agent may call. The model never writes
 * SQL and never deals in Plaid category codes — it passes a plain `topic`
 * ("groceries", "dining out", "coffee"…) that the semantic layer in topics.ts
 * resolves to exact codes. Totals are computed server-side so answers are exact
 * and grounded.
 */

/**
 * gpt-oss on Groq routinely fills every optional argument with `null`, and Groq
 * validates the emitted tool args against the advertised JSON schema BEFORE the
 * call reaches us — so unless the schema permits null we get a hard 400
 * ("tool call validation failed"). We therefore (a) advertise `["<type>","null"]`
 * for every optional param via the `j*` helpers below, and (b) coerce null back
 * to "absent" in zod via `nullToUndef` so the run handlers see clean values.
 */
const nullToUndef = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (v === null ? undefined : v), s);

// JSON-schema fragments advertised to the model (each one accepts null).
const jStr = (description: string) => ({ type: ["string", "null"], description });
const jNum = (description: string) => ({ type: ["number", "null"], description });
const jEnum = (vals: readonly string[], description: string) => ({
  type: ["string", "null"],
  enum: [...vals, null],
  description,
});
const jTopic = () =>
  jStr(
    `spending topic, e.g. ${TOPIC_NAMES.slice(0, 14).join(", ")}, etc. Omit for ALL spending. ` +
      `"dining out" = restaurants + fast food + coffee (excludes groceries); "groceries" = grocery stores only.`,
  );

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

interface ResolvedRange {
  from?: Date;
  to?: Date;
  label: string;
}

/** Resolve a date range; default to the last 3 months and always label it so
 *  the model can tell the user which window the answer covers. */
function resolveRange(fromStr?: string, toStr?: string): ResolvedRange {
  const from = parseDate(fromStr);
  const to = parseDate(toStr, true);
  if (!from && !to) {
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    return { from: start, label: `the last 3 months (since ${iso(start)})` };
  }
  if (from && to) return { from, to, label: `${iso(from)} to ${iso(to)}` };
  if (from) return { from, label: `since ${iso(from)}` };
  return { to: to!, label: `through ${iso(to!)}` };
}

/** Resolve a topic string to a scope, or an error result for the model. */
function scopeFor(topic?: string): { scope?: TopicScope; error?: string } {
  if (!topic) return {};
  const scope = resolveTopic(topic);
  if (!scope) {
    return {
      error: `Unknown topic "${topic}". Use a known topic like: ${TOPIC_NAMES.slice(0, 16).join(", ")} — or omit topic for all spending.`,
    };
  }
  return { scope };
}

/** Translate a topic scope into analytics filter fields. */
function scopeFilter(scope?: TopicScope): { category?: string; detailed?: string[] } {
  if (!scope) return {};
  if (scope.detailed) return { detailed: scope.detailed };
  return { category: scope.primary };
}

const dateRange = {
  from: nullToUndef(z.string().optional()),
  to: nullToUndef(z.string().optional()),
};
const jDateRange = {
  from: jStr("start date YYYY-MM-DD (optional; default last 3 months)"),
  to: jStr("end date YYYY-MM-DD (optional)"),
};
const topicArg = { topic: nullToUndef(z.string().optional()) };

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema for the model
  schema: z.ZodTypeAny;
  run: (args: unknown) => Promise<unknown>;
}

const TOOLS: Tool[] = [
  {
    name: "get_spending",
    description:
      "Exact total amount spent (and transaction count) for a TOPIC over a date range. This is the tool for 'how much did I spend on X'. Omit topic for total spending. Defaults to the last 3 months when no dates are given — always tell the user the window from the result's `range`.",
    parameters: {
      type: "object",
      properties: { topic: jTopic(), ...jDateRange },
    },
    schema: z.object({ ...topicArg, ...dateRange }),
    run: async (args) => {
      const a = z.object({ ...topicArg, ...dateRange }).parse(args);
      const { scope, error } = scopeFor(a.topic);
      if (error) return { error };
      const range = resolveRange(a.from, a.to);
      const total = await spendingTotal({ from: range.from, to: range.to, ...scopeFilter(scope) });
      return {
        topic: scope?.label ?? "all spending",
        range: range.label,
        total: formatCents(total.totalCents),
        transactions: total.count,
      };
    },
  },
  {
    name: "get_top_merchants",
    description:
      "Ranks merchants by spend or visits, optionally scoped to a topic and date range. Each row has the merchant, total spend, and visit count. sort='visits' = 'where do I go most often'; sort='spend' (default) = 'where do I spend the most'. Defaults to the last 3 months — report the range.",
    parameters: {
      type: "object",
      properties: {
        topic: jTopic(),
        sort: jEnum(["spend", "visits"], "spend = total dollars (default); visits = how often"),
        ...jDateRange,
        limit: jNum("max merchants (default 10)"),
      },
    },
    schema: z.object({
      ...topicArg,
      sort: nullToUndef(z.enum(["spend", "visits"]).optional()),
      ...dateRange,
      limit: nullToUndef(z.number().optional()),
    }),
    run: async (args) => {
      const a = z
        .object({
          ...topicArg,
          sort: nullToUndef(z.enum(["spend", "visits"]).optional()),
          ...dateRange,
          limit: nullToUndef(z.number().optional()),
        })
        .parse(args);
      const { scope, error } = scopeFor(a.topic);
      if (error) return { error };
      const range = resolveRange(a.from, a.to);
      const rows = await topMerchants(
        { from: range.from, to: range.to, sort: a.sort, ...scopeFilter(scope) },
        Math.min(a.limit ?? 10, 25),
      );
      return {
        topic: scope?.label ?? "all spending",
        range: range.label,
        merchants: rows.map((r) => ({
          merchant: r.merchant,
          total: formatCents(r.totalCents),
          visits: r.count,
        })),
      };
    },
  },
  {
    name: "get_transactions",
    description:
      "List individual transactions, optionally scoped to a topic, a free-text merchant search, and a date range. Most recent first. Use for 'how many times / what dates / list my X'. For a SPECIFIC named place use search= with NO topic (it may be categorized unexpectedly). Defaults to the last 3 months — report the range.",
    parameters: {
      type: "object",
      properties: {
        topic: jTopic(),
        search: jStr("specific merchant/name substring; omit when using a topic"),
        ...jDateRange,
        limit: jNum("max rows (default 20, max 50)"),
      },
    },
    schema: z.object({
      ...topicArg,
      search: nullToUndef(z.string().optional()),
      ...dateRange,
      limit: nullToUndef(z.number().optional()),
    }),
    run: async (args) => {
      const a = z
        .object({
          ...topicArg,
          search: nullToUndef(z.string().optional()),
          ...dateRange,
          limit: nullToUndef(z.number().optional()),
        })
        .parse(args);
      const { scope, error } = scopeFor(a.topic);
      if (error) return { error };
      const range = resolveRange(a.from, a.to);
      const rows = await listTransactions({
        from: range.from,
        to: range.to,
        search: a.search,
        ...scopeFilter(scope),
        limit: Math.min(a.limit ?? 20, 50),
      });
      return {
        range: range.label,
        count: rows.length,
        transactions: rows.map((t) => ({
          date: t.postedAt ? iso(t.postedAt) : null,
          merchant: t.merchantName ?? t.name,
          account: t.accountName,
          category: humanizeCategory(t.category),
          amount: formatCents(t.amountCents),
          pending: t.pending,
        })),
      };
    },
  },
  {
    name: "get_spending_by_category",
    description:
      "High-level overview: spending broken down by primary category over a date range (defaults to the last 3 months). Use for 'where does my money go' / 'break down my spending'. For a single topic's exact total, use get_spending instead.",
    parameters: { type: "object", properties: { ...jDateRange } },
    schema: z.object({ ...dateRange }),
    run: async (args) => {
      const a = z.object({ ...dateRange }).parse(args);
      const range = resolveRange(a.from, a.to);
      const rows = await spendingByCategory({ from: range.from, to: range.to });
      return {
        range: range.label,
        categories: rows.map((r) => ({
          category: humanizeCategory(r.category),
          total: formatCents(r.totalCents),
          transactions: r.count,
        })),
      };
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
      properties: {
        window: jEnum(["month", "quarter", "all"], "time window (default all)"),
      },
    },
    schema: z.object({ window: nullToUndef(z.enum(["month", "quarter", "all"]).optional()) }),
    run: async (args) => {
      const a = z
        .object({ window: nullToUndef(z.enum(["month", "quarter", "all"]).optional()) })
        .parse(args);
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
