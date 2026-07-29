import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./client";
import { cards, accounts, items } from "./schema";
import type { CardDef, EarnRules, CapPeriod } from "@/lib/rewards/catalog";
import type { RewardTag } from "@/lib/rewards/config";
import type { CardRewardSuggestion } from "@/lib/ai/card-rewards";

/**
 * Card persistence for the rewards engine. Cards live in the DB and are managed
 * by the user (see the Cards page); the engine loads them via loadCards().
 */

export interface SeedResult {
  cardId: string;
  label: string;
  accountId: string | null;
}

/**
 * Ensure every synced credit account has a card. Creates a default flat-1%
 * card for any credit account that doesn't have one yet, and NEVER overwrites
 * an existing card — so user-configured reward rules survive every sync. Runs
 * as part of sync; cloners get their cards auto-populated to then customize.
 */
export async function seedCards(): Promise<SeedResult[]> {
  const creditAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.type, "credit"));

  const linkedRows = await db.select({ accountId: cards.accountId }).from(cards);
  const linked = new Set(linkedRows.map((r) => r.accountId).filter((x): x is string => !!x));

  const results: SeedResult[] = [];
  for (const acct of creditAccounts) {
    if (linked.has(acct.id)) continue;
    const id = randomUUID();
    const earnRules: EarnRules = { kind: "category", currency: "cashback", baseBps: 100, bonuses: {} };
    await db.insert(cards).values({
      id,
      accountId: acct.id,
      label: acct.name,
      network: "card",
      earnRules,
      cashbackMatchYearOne: false,
    });
    results.push({ cardId: id, label: acct.name, accountId: acct.id });
  }
  return results;
}

export interface LoadedCards {
  cards: CardDef[];
  accountToCardId: Map<string, string>;
  cardById: Map<string, CardDef>;
}

/**
 * Load engine-ready cards (CONFIRMED only — unconfirmed AI suggestions must not
 * drive recommendations) + an account->card map.
 */
export async function loadCards(): Promise<LoadedCards> {
  const rows = await db.select().from(cards).where(eq(cards.rewardsConfirmed, true));
  const defs: CardDef[] = [];
  const accountToCardId = new Map<string, string>();
  const cardById = new Map<string, CardDef>();

  for (const r of rows) {
    const def: CardDef = {
      id: r.id,
      label: r.label,
      network: r.network,
      institutionMatch: "", // not needed at runtime
      earnRules: r.earnRules as EarnRules,
      cashbackMatchYearOne: r.cashbackMatchYearOne,
    };
    defs.push(def);
    cardById.set(def.id, def);
    if (r.accountId) accountToCardId.set(r.accountId, def.id);
  }
  return { cards: defs, accountToCardId, cardById };
}

// ---------------------------------------------------------------------------
// Card manager CRUD (user-editable cards with per-category cashback rates).
// ---------------------------------------------------------------------------

export interface RotatingSummary {
  bonusBps: number;
  baseBps: number;
  capCents: number | null;
  capPeriod: CapPeriod | null;
  schedule: Record<string, RewardTag[]>;
}

export interface ManagedCard {
  id: string;
  label: string;
  accountId: string | null;
  accountName: string | null;
  institution: string | null;
  network: string;
  ruleKind: EarnRules["kind"];
  /** Base rate (bps) for category/flat cards; null for advanced (miles) rules. */
  baseBps: number | null;
  bonuses: Record<string, number>; // reward tag -> bps (category cards only)
  caps: Record<string, { cents: number; period: CapPeriod }>; // category cards only
  rotating: RotatingSummary | null;
  rewardsConfirmed: boolean;
  annualFeeCents: number | null;
  signupBonus: string | null;
  aiNotes: string | null;
  aiSuggestion: CardRewardSuggestion | null;
}

export async function listManagedCards(): Promise<ManagedCard[]> {
  const rows = await db
    .select({
      id: cards.id,
      label: cards.label,
      accountId: cards.accountId,
      network: cards.network,
      earnRules: cards.earnRules,
      accountName: accounts.name,
      institution: items.institutionName,
      rewardsConfirmed: cards.rewardsConfirmed,
      annualFeeCents: cards.annualFeeCents,
      signupBonus: cards.signupBonus,
      aiNotes: cards.aiNotes,
      aiSuggestion: cards.aiSuggestion,
    })
    .from(cards)
    .leftJoin(accounts, eq(accounts.id, cards.accountId))
    .leftJoin(items, eq(items.id, accounts.itemId));

  return rows.map((r) => {
    const rules = r.earnRules as EarnRules;
    let baseBps: number | null = null;
    let bonuses: Record<string, number> = {};
    let caps: Record<string, { cents: number; period: CapPeriod }> = {};
    let rotating: RotatingSummary | null = null;
    if (rules.kind === "category") {
      baseBps = rules.baseBps;
      bonuses = { ...rules.bonuses } as Record<string, number>;
      caps = { ...(rules.caps ?? {}) } as Record<string, { cents: number; period: CapPeriod }>;
    } else if (rules.kind === "flat") {
      baseBps = rules.bps;
    } else if (rules.kind === "rotating") {
      baseBps = rules.baseBps;
      rotating = {
        bonusBps: rules.bonusBps,
        baseBps: rules.baseBps,
        capCents: rules.capCents ?? null,
        capPeriod: rules.capPeriod ?? null,
        schedule: rules.schedule ?? {},
      };
    }
    return {
      id: r.id,
      label: r.label,
      accountId: r.accountId,
      accountName: r.accountName ?? null,
      institution: r.institution ?? null,
      network: r.network,
      ruleKind: rules.kind,
      baseBps,
      bonuses,
      caps,
      rotating,
      rewardsConfirmed: r.rewardsConfirmed,
      annualFeeCents: r.annualFeeCents,
      signupBonus: r.signupBonus,
      aiNotes: r.aiNotes,
      aiSuggestion: (r.aiSuggestion as CardRewardSuggestion | null) ?? null,
    };
  });
}

/** Minimal fetch for the AI lookup (needs the card's name). */
export async function getCardById(id: string): Promise<{ id: string; label: string } | undefined> {
  const [row] = await db.select({ id: cards.id, label: cards.label }).from(cards).where(eq(cards.id, id)).limit(1);
  return row;
}

/** Cache the AI suggestion for a card so the confirm UI can render it. */
export async function setCardSuggestion(id: string, suggestion: CardRewardSuggestion): Promise<void> {
  await db.update(cards).set({ aiSuggestion: suggestion }).where(eq(cards.id, id));
}

/** The server-trusted cached AI suggestion for a card. */
export async function getCardSuggestion(id: string): Promise<CardRewardSuggestion | null> {
  const [row] = await db.select({ s: cards.aiSuggestion }).from(cards).where(eq(cards.id, id)).limit(1);
  return (row?.s as CardRewardSuggestion | null) ?? null;
}

export interface ConfirmCardInput {
  earnRules: EarnRules;
  annualFeeCents: number | null;
  signupBonus: string | null;
  notes: string | null;
  cashbackMatchYearOne: boolean;
}

/** Apply confirmed rewards and mark the card confirmed (so it counts now). */
export async function confirmCard(id: string, input: ConfirmCardInput): Promise<void> {
  await db
    .update(cards)
    .set({
      earnRules: input.earnRules,
      annualFeeCents: input.annualFeeCents,
      signupBonus: input.signupBonus,
      aiNotes: input.notes,
      cashbackMatchYearOne: input.cashbackMatchYearOne,
      rewardsConfirmed: true,
    })
    .where(eq(cards.id, id));
}

export interface CreditAccountOption {
  id: string;
  name: string;
  institution: string | null;
}

export async function listCreditAccounts(): Promise<CreditAccountOption[]> {
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, institution: items.institutionName })
    .from(accounts)
    .leftJoin(items, eq(items.id, accounts.itemId))
    .where(eq(accounts.type, "credit"));
  return rows.map((r) => ({ id: r.id, name: r.name, institution: r.institution ?? null }));
}

export interface CardInput {
  label: string;
  accountId: string | null;
  network: string;
  baseBps: number;
  bonuses: Record<string, number>;
}

function categoryRules(input: CardInput): EarnRules {
  return {
    kind: "category",
    currency: "cashback",
    baseBps: input.baseBps,
    bonuses: input.bonuses as Partial<Record<RewardTag, number>>,
  };
}

export async function createManagedCard(input: CardInput): Promise<void> {
  await db.insert(cards).values({
    id: randomUUID(),
    accountId: input.accountId,
    label: input.label,
    network: input.network || "card",
    earnRules: categoryRules(input),
    cashbackMatchYearOne: false,
  });
}

export async function updateManagedCard(id: string, input: CardInput): Promise<void> {
  await db
    .update(cards)
    .set({
      accountId: input.accountId,
      label: input.label,
      network: input.network || "card",
      earnRules: categoryRules(input),
    })
    .where(eq(cards.id, id));
}

export async function deleteManagedCard(id: string): Promise<void> {
  await db.delete(cards).where(eq(cards.id, id));
}
