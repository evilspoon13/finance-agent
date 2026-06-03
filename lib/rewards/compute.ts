import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { transactions } from "@/lib/db/schema";
import { loadCards } from "@/lib/db/rewards-queries";
import { deriveTags } from "./tags";
import { bestCard, evaluateCard, type RewardContext } from "./engine";
import {
  DISCOVER_CAP_CENTS,
  MILES_VALUE_CENTS,
  discoverCategoriesFor,
  quarterKey,
  type RewardTag,
} from "./config";
import type { CardDef } from "./catalog";

/**
 * Chronological, cap-aware pass over real purchases. For each purchase it
 * computes the optimal card and the reward delta vs the card actually used,
 * tracking Discover's $1,500/quarter 5% cap consumption (from actual Discover
 * spend in active categories) so recommendations stop favoring Discover once
 * the cap is hit.
 *
 * `recomputeAndPersist` writes optimal_card_id + reward_delta_cents (the
 * persisted seam the future alerter reads). `analyzeRewards` returns the same
 * computation plus dashboard aggregates without requiring the stored columns.
 */

// Purchases only: outflows, posted, excluding transfers / credit-card payments.
const PURCHASE_WHERE = and(
  sql`${transactions.amountCents} > 0`,
  eq(transactions.pending, false),
  sql`coalesce(${transactions.pfcPrimary}, '') not in ('TRANSFER_IN', 'TRANSFER_OUT')`,
  sql`coalesce(${transactions.pfcDetailed}, '') <> 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'`,
);

interface TxnSlim {
  id: string;
  accountId: string;
  amountCents: number;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  merchantName: string | null;
  name: string;
  postedAt: Date | null;
}

export interface PerCardSummary {
  cardId: string;
  label: string;
  earnedCents: number;
  txnCount: number;
}

export interface MissedRow {
  id: string;
  postedAt: Date | null;
  label: string;
  amountCents: number;
  actualLabel: string;
  optimalLabel: string;
  deltaCents: number;
}

export interface GuideRow {
  category: RewardTag | "everything else";
  bestLabel: string;
  effectiveBps: number;
}

export interface RewardsReport {
  perCard: PerCardSummary[];
  missed: MissedRow[];
  guide: GuideRow[];
  totalEarnedCents: number;
  totalMissedCents: number;
  hasCards: boolean;
}

interface TxnResult {
  id: string;
  optimalCardId: string;
  deltaCents: number;
}

async function loadPurchases(): Promise<TxnSlim[]> {
  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      pfcPrimary: transactions.pfcPrimary,
      pfcDetailed: transactions.pfcDetailed,
      merchantName: transactions.merchantName,
      name: transactions.name,
      postedAt: transactions.postedAt,
    })
    .from(transactions)
    .where(PURCHASE_WHERE)
    .orderBy(asc(transactions.postedAt));
}

interface Analysis {
  results: TxnResult[];
  report: RewardsReport;
}

const EMPTY_REPORT: RewardsReport = {
  perCard: [],
  missed: [],
  guide: [],
  totalEarnedCents: 0,
  totalMissedCents: 0,
  hasCards: false,
};

export interface RewardWindow {
  from?: Date;
  to?: Date;
}

function inWindow(d: Date | null, w?: RewardWindow): boolean {
  if (!w) return true;
  if (w.from && (!d || d < w.from)) return false;
  if (w.to && (!d || d > w.to)) return false;
  return true;
}

async function analyze(window?: RewardWindow): Promise<Analysis> {
  const { cards, accountToCardId, cardById } = await loadCards();
  // No cards seeded yet (e.g. before the first sync): nothing to compute.
  if (cards.length === 0) return { results: [], report: EMPTY_REPORT };

  const purchases = await loadPurchases();

  const discoverCard = cards.find((c) => c.earnRules.kind === "rotating");
  // Discover bonus-category spend consumed per quarter (drives remaining cap).
  const bonusSpentByQuarter = new Map<string, number>();

  const results: TxnResult[] = [];
  const earnedByCard = new Map<string, { cents: number; count: number }>();
  const missed: MissedRow[] = [];
  let totalEarned = 0;
  let totalMissed = 0;

  for (const t of purchases) {
    const when = t.postedAt ?? new Date();
    const qk = quarterKey(when);
    const spent = bonusSpentByQuarter.get(qk) ?? 0;
    const ctx: RewardContext = {
      discoverActive: new Set(discoverCategoriesFor(when)),
      discoverCapRemainingCents: Math.max(0, DISCOVER_CAP_CENTS - spent),
      milesValueCents: MILES_VALUE_CENTS,
    };

    const tags = deriveTags(t);
    const { best } = bestCard(cards, tags, t.amountCents, ctx);

    const actualCardId = accountToCardId.get(t.accountId);
    const actualCard = actualCardId ? cardById.get(actualCardId) : undefined;
    const actualValue = actualCard ? evaluateCard(actualCard, tags, t.amountCents, ctx).valueCents : 0;
    const delta = Math.max(0, best.valueCents - actualValue);

    results.push({ id: t.id, optimalCardId: best.cardId, deltaCents: delta });

    // Aggregate only within the requested window (the chronological pass and
    // persisted results above always cover all history for cap correctness).
    if (inWindow(t.postedAt, window)) {
      // Per-card earned (value actually earned on the card used).
      if (actualCardId) {
        const agg = earnedByCard.get(actualCardId) ?? { cents: 0, count: 0 };
        agg.cents += actualValue;
        agg.count += 1;
        earnedByCard.set(actualCardId, agg);
        totalEarned += actualValue;
      }

      // Missed: a different card would have beaten the one used.
      if (delta > 0 && best.cardId !== actualCardId) {
        totalMissed += delta;
        missed.push({
          id: t.id,
          postedAt: t.postedAt,
          label: t.merchantName ?? t.name,
          amountCents: t.amountCents,
          actualLabel: actualCard?.label ?? "Non-card account",
          optimalLabel: cardById.get(best.cardId)?.label ?? best.cardId,
          deltaCents: delta,
        });
      }
    }

    // Consume the cap from actual Discover-card spend in active categories.
    if (
      discoverCard &&
      actualCardId === discoverCard.id &&
      [...tags].some((tag) => ctx.discoverActive.has(tag))
    ) {
      bonusSpentByQuarter.set(qk, spent + t.amountCents);
    }
  }

  const perCard: PerCardSummary[] = cards.map((c) => ({
    cardId: c.id,
    label: c.label,
    earnedCents: earnedByCard.get(c.id)?.cents ?? 0,
    txnCount: earnedByCard.get(c.id)?.count ?? 0,
  }));

  missed.sort((a, b) => b.deltaCents - a.deltaCents);

  return {
    results,
    report: {
      perCard,
      missed,
      guide: buildGuide(cards, cardById),
      totalEarnedCents: totalEarned,
      totalMissedCents: totalMissed,
      hasCards: cards.length > 0,
    },
  };
}

const GUIDE_CATEGORIES: (RewardTag | "everything else")[] = [
  "dining",
  "grocery",
  "wholesale_club",
  "streaming",
  "gas",
  "ev_charging",
  "transit",
  "flights",
  "hotel",
  "drugstore",
  "home_improvement",
  "united",
  "everything else",
];

function buildGuide(cards: CardDef[], cardById: Map<string, CardDef>): GuideRow[] {
  const ctx: RewardContext = {
    discoverActive: new Set(discoverCategoriesFor(new Date())),
    discoverCapRemainingCents: DISCOVER_CAP_CENTS,
    milesValueCents: MILES_VALUE_CENTS,
  };
  return GUIDE_CATEGORIES.map((cat) => {
    const tags = new Set<RewardTag>(cat === "everything else" ? [] : [cat]);
    const { best } = bestCard(cards, tags, 10_000, ctx); // representative $100
    return {
      category: cat,
      bestLabel: cardById.get(best.cardId)?.label ?? best.cardId,
      effectiveBps: best.effectiveBps,
    };
  });
}

/** Read-only: compute the dashboard report (optionally scoped to a date window)
 *  without touching stored columns. */
export async function analyzeRewards(window?: RewardWindow): Promise<RewardsReport> {
  return (await analyze(window)).report;
}

/** Compute and persist optimal_card_id + reward_delta_cents for every purchase. */
export async function recomputeAndPersist(): Promise<{ updated: number; report: RewardsReport }> {
  const { results, report } = await analyze();
  for (const r of results) {
    await db
      .update(transactions)
      .set({ optimalCardId: r.optimalCardId, rewardDeltaCents: r.deltaCents })
      .where(eq(transactions.id, r.id));
  }
  return { updated: results.length, report };
}
