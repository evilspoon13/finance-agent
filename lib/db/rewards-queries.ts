import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./client";
import { cards, accounts, items } from "./schema";
import type { CardDef, EarnRules } from "@/lib/rewards/rules";

/**
 * Card persistence for the rewards engine. Cards live in the DB and are managed
 * by the user (see the Cards page); the engine loads them via loadCards().
 */

/**
 * Ensure every synced credit account has a card. Creates a default 1% card for
 * any credit account that doesn't have one yet, and NEVER overwrites an
 * existing card — so user-configured reward rules survive every sync.
 */
export async function seedCards(): Promise<void> {
  const creditAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.type, "credit"));

  const linkedRows = await db.select({ accountId: cards.accountId }).from(cards);
  const linked = new Set(linkedRows.map((r) => r.accountId).filter((x): x is string => !!x));

  for (const acct of creditAccounts) {
    if (linked.has(acct.id)) continue;
    const earnRules: EarnRules = { kind: "category", baseBps: 100, bonuses: {} };
    await db.insert(cards).values({ id: randomUUID(), accountId: acct.id, label: acct.name, earnRules });
  }
}

export interface LoadedCards {
  cards: CardDef[];
  accountToCardId: Map<string, string>;
  cardById: Map<string, CardDef>;
}

/** Load engine-ready cards + an account->card map. */
export async function loadCards(): Promise<LoadedCards> {
  const rows = await db.select().from(cards);
  const defs: CardDef[] = [];
  const accountToCardId = new Map<string, string>();
  const cardById = new Map<string, CardDef>();

  for (const r of rows) {
    const def: CardDef = { id: r.id, label: r.label, earnRules: r.earnRules as EarnRules };
    defs.push(def);
    cardById.set(def.id, def);
    if (r.accountId) accountToCardId.set(r.accountId, def.id);
  }
  return { cards: defs, accountToCardId, cardById };
}

// ---------------------------------------------------------------------------
// Card manager CRUD.
// ---------------------------------------------------------------------------

export interface ManagedCard {
  id: string;
  label: string;
  accountId: string | null;
  accountName: string | null;
  institution: string | null;
  earnRules: EarnRules;
  annualFeeCents: number | null;
  signupBonus: string | null;
  notes: string | null;
}

export async function listManagedCards(): Promise<ManagedCard[]> {
  const rows = await db
    .select({
      id: cards.id,
      label: cards.label,
      accountId: cards.accountId,
      earnRules: cards.earnRules,
      accountName: accounts.name,
      institution: items.institutionName,
      annualFeeCents: cards.annualFeeCents,
      signupBonus: cards.signupBonus,
      notes: cards.notes,
    })
    .from(cards)
    .leftJoin(accounts, eq(accounts.id, cards.accountId))
    .leftJoin(items, eq(items.id, accounts.itemId))
    .orderBy(cards.label);

  return rows.map((r) => ({
    ...r,
    earnRules: r.earnRules as EarnRules,
    accountName: r.accountName ?? null,
    institution: r.institution ?? null,
  }));
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
  earnRules: EarnRules;
  annualFeeCents: number | null;
  signupBonus: string | null;
  notes: string | null;
}

export async function createManagedCard(input: CardInput): Promise<void> {
  await db.insert(cards).values({ id: randomUUID(), ...input });
}

export async function updateManagedCard(id: string, input: CardInput): Promise<void> {
  await db.update(cards).set(input).where(eq(cards.id, id));
}

export async function deleteManagedCard(id: string): Promise<void> {
  await db.delete(cards).where(eq(cards.id, id));
}
