import { eq, and, ilike } from "drizzle-orm";
import { db } from "./client";
import { cards, accounts, items } from "./schema";
import { CARD_CATALOG, type CardDef, type EarnRules } from "@/lib/rewards/catalog";
import { DISCOVER_CAP_CENTS } from "@/lib/rewards/config";

/**
 * Seed the cards table from the catalog, linking each card to the synced credit
 * account at its institution, and load cards back into engine-ready CardDefs.
 */

export interface SeedResult {
  cardId: string;
  label: string;
  accountId: string | null;
}

export async function seedCards(): Promise<SeedResult[]> {
  const results: SeedResult[] = [];
  for (const def of CARD_CATALOG) {
    // Find a credit account at the matching institution.
    const [acct] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .innerJoin(items, eq(items.id, accounts.itemId))
      .where(and(ilike(items.institutionName, `%${def.institutionMatch}%`), eq(accounts.type, "credit")))
      .limit(1);

    const accountId = acct?.id ?? null;
    await db
      .insert(cards)
      .values({
        id: def.id,
        accountId,
        label: def.label,
        network: def.network,
        earnRules: def.earnRules,
        discoverCapCents: def.earnRules.kind === "rotating" ? DISCOVER_CAP_CENTS : null,
        cashbackMatchYearOne: def.cashbackMatchYearOne,
      })
      .onConflictDoUpdate({
        target: cards.id,
        set: {
          accountId,
          label: def.label,
          network: def.network,
          earnRules: def.earnRules,
          discoverCapCents: def.earnRules.kind === "rotating" ? DISCOVER_CAP_CENTS : null,
          cashbackMatchYearOne: def.cashbackMatchYearOne,
        },
      });
    results.push({ cardId: def.id, label: def.label, accountId });
  }
  return results;
}

export interface LoadedCards {
  cards: CardDef[];
  accountToCardId: Map<string, string>;
  cardById: Map<string, CardDef>;
}

/** Load cards from the DB into engine-ready CardDefs + an account->card map. */
export async function loadCards(): Promise<LoadedCards> {
  const rows = await db.select().from(cards);
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
