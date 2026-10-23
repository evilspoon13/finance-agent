import { eq, inArray } from "drizzle-orm";
import type {
  Transaction as PlaidTransaction,
  Holding as PlaidHolding,
  Security,
  InvestmentTransaction as PlaidInvestmentTransaction,
} from "plaid";
import { db } from "./client";
import {
  transactions,
  holdings,
  investmentTransactions,
  accounts,
  type NewTransaction,
  type NewInvestmentTransaction,
} from "./schema";
import { dollarsToCents } from "@/lib/money";

/**
 * Sync write helpers: idempotent transaction upserts/deletes, the
 * pending->posted replacement rule, balance updates, and holdings refresh.
 */

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Map a Plaid transaction to our row. Sign convention matches Plaid for
 * depository/credit accounts: positive amount = money leaving the account.
 */
function mapTransaction(t: PlaidTransaction): NewTransaction {
  return {
    id: t.transaction_id,
    accountId: t.account_id,
    amountCents: dollarsToCents(t.amount),
    merchantName: t.merchant_name ?? null,
    name: t.name,
    pfcPrimary: t.personal_finance_category?.primary ?? null,
    pfcDetailed: t.personal_finance_category?.detailed ?? null,
    mcc: null, // Plaid /transactions/sync does not expose MCC directly.
    pending: t.pending,
    pendingTransactionId: t.pending_transaction_id ?? null,
    authorizedAt: toDate(t.authorized_datetime ?? t.authorized_date),
    postedAt: toDate(t.datetime ?? t.date),
    updatedAt: new Date(),
  };
}

/**
 * Apply `added` + `modified` transactions as upserts keyed on transaction_id.
 * When a posted transaction carries a pending_transaction_id, delete the stale
 * pending placeholder so a purchase is never double-counted.
 */
export async function applyUpserts(rows: PlaidTransaction[]): Promise<number> {
  for (const t of rows) {
    const row = mapTransaction(t);

    // Pending->posted replacement: a posted txn replaces its pending row.
    if (!t.pending && t.pending_transaction_id) {
      await db.delete(transactions).where(eq(transactions.id, t.pending_transaction_id));
    }

    await db
      .insert(transactions)
      .values(row)
      .onConflictDoUpdate({
        target: transactions.id,
        set: {
          accountId: row.accountId,
          amountCents: row.amountCents,
          merchantName: row.merchantName,
          name: row.name,
          pfcPrimary: row.pfcPrimary,
          pfcDetailed: row.pfcDetailed,
          mcc: row.mcc,
          pending: row.pending,
          pendingTransactionId: row.pendingTransactionId,
          authorizedAt: row.authorizedAt,
          postedAt: row.postedAt,
          updatedAt: new Date(),
          // optimal_card_id / reward_delta_cents are filled in by the rewards pass.
        },
      });
  }
  return rows.length;
}

/** Apply `removed` transactions (delete by transaction_id). */
export async function applyRemovals(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  await db.delete(transactions).where(inArray(transactions.id, ids));
  return ids.length;
}

/**
 * Upsert investment transactions keyed on Plaid's stable
 * investment_transaction_id (idempotent across re-syncs). Security ticker/name
 * are denormalized from the securities list for display.
 */
export async function applyInvestmentTransactions(
  invTxns: PlaidInvestmentTransaction[],
  securities: Security[],
): Promise<number> {
  if (invTxns.length === 0) return 0;
  const securityById = new Map(securities.map((s) => [s.security_id, s]));

  for (const it of invTxns) {
    const sec = it.security_id ? securityById.get(it.security_id) : undefined;
    const row: NewInvestmentTransaction = {
      id: it.investment_transaction_id,
      accountId: it.account_id,
      securityId: it.security_id ?? null,
      ticker: sec?.ticker_symbol ?? null,
      securityName: sec?.name ?? null,
      name: it.name,
      type: String(it.type),
      subtype: it.subtype ? String(it.subtype) : null,
      quantity: String(it.quantity),
      priceCents: dollarsToCents(it.price),
      amountCents: dollarsToCents(it.amount), // positive = cash out (buy)
      feesCents: it.fees == null ? null : dollarsToCents(it.fees),
      isoCurrency: it.iso_currency_code ?? "USD",
      postedAt: toDate(it.transaction_datetime ?? it.date),
      updatedAt: new Date(),
    };
    await db
      .insert(investmentTransactions)
      .values(row)
      .onConflictDoUpdate({
        target: investmentTransactions.id,
        set: {
          accountId: row.accountId,
          securityId: row.securityId,
          ticker: row.ticker,
          securityName: row.securityName,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          quantity: row.quantity,
          priceCents: row.priceCents,
          amountCents: row.amountCents,
          feesCents: row.feesCents,
          isoCurrency: row.isoCurrency,
          postedAt: row.postedAt,
          updatedAt: new Date(),
        },
      });
  }
  return invTxns.length;
}

/** Update cached balances for an account (cents). */
export async function updateAccountBalance(
  accountId: string,
  currentCents: number | null,
  availableCents: number | null,
): Promise<void> {
  await db
    .update(accounts)
    .set({
      currentBalanceCents: currentCents,
      availableBalanceCents: availableCents,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, accountId));
}

/**
 * Replace all holdings for the given accounts with a fresh snapshot.
 * Holdings have no stable Plaid id, so we delete-then-insert per account.
 */
export async function replaceHoldings(
  accountIds: string[],
  plaidHoldings: PlaidHolding[],
  securities: Security[],
): Promise<number> {
  if (accountIds.length === 0) return 0;
  const securityById = new Map(securities.map((s) => [s.security_id, s]));

  await db.delete(holdings).where(inArray(holdings.accountId, accountIds));

  let inserted = 0;
  for (const h of plaidHoldings) {
    const sec = securityById.get(h.security_id);
    await db.insert(holdings).values({
      id: `${h.account_id}:${h.security_id}`,
      accountId: h.account_id,
      securityId: h.security_id,
      ticker: sec?.ticker_symbol ?? null,
      name: sec?.name ?? "Unknown security",
      quantity: String(h.quantity),
      valueCents: dollarsToCents(h.institution_value),
      costBasisCents: h.cost_basis === null || h.cost_basis === undefined
        ? null
        : dollarsToCents(h.cost_basis),
      updatedAt: new Date(),
    });
    inserted += 1;
  }
  return inserted;
}
