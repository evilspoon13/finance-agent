import type { Item } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { plaid } from "./client";
import { dollarsToCents } from "@/lib/money";
import {
  getAllItems,
  getItemById,
  updateItemCursor,
  upsertAccounts,
} from "@/lib/db/queries";
import {
  applyUpserts,
  applyRemovals,
  updateAccountBalance,
  replaceHoldings,
  applyInvestmentTransactions,
} from "@/lib/db/sync-queries";

/**
 * Sync orchestration for a Plaid item: transactions (cursor-based, idempotent),
 * balances, and investment holdings. The per-item cursor is the source of truth;
 * re-running must never duplicate or drop data.
 */

export interface SyncResult {
  itemId: string;
  institution: string;
  added: number;
  modified: number;
  removed: number;
  accounts: number;
  holdings: number;
  investmentTxns: number;
  error?: string;
}

/**
 * Items whose id starts with `manual_` are hand-entered (institutions Plaid
 * can't reach, e.g. Optum Bank HSA). They hold no real access token, so syncing
 * them would only throw; their balances are maintained by hand in SQL.
 */
export function isManualItem(item: { id: string }): boolean {
  return item.id.startsWith("manual_");
}

export async function syncAllItems(): Promise<SyncResult[]> {
  const items = await getAllItems();
  const results: SyncResult[] = [];
  for (const item of items) {
    if (isManualItem(item)) continue;
    results.push(await syncItem(item));
  }
  return results;
}

export async function syncItemById(id: string): Promise<SyncResult> {
  const item = await getItemById(id);
  if (!item) throw new Error(`No item ${id}`);
  if (isManualItem(item)) throw new Error(`Item ${id} is manual; nothing to sync`);
  return syncItem(item);
}

export async function syncItem(item: Item): Promise<SyncResult> {
  const result: SyncResult = {
    itemId: item.id,
    institution: item.institutionName,
    added: 0,
    modified: 0,
    removed: 0,
    accounts: 0,
    holdings: 0,
    investmentTxns: 0,
  };

  try {
    const accessToken = decrypt(item.accessTokenEnc);
    const tx = await syncTransactions(item.id, accessToken);
    result.added = tx.added;
    result.modified = tx.modified;
    result.removed = tx.removed;
    result.accounts = await refreshBalances(accessToken);
    result.holdings = await refreshHoldings(accessToken);
    result.investmentTxns = await refreshInvestmentTransactions(accessToken);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

async function syncTransactions(itemId: string, accessToken: string) {
  let cursor: string | undefined; // undefined => full history from the start
  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await plaid().transactionsSync({
      access_token: accessToken,
      cursor,
      // include personal_finance_category etc. by default in current SDK
    });
    const data = res.data;

    // Ensure referenced accounts exist before writing transactions (FK safety).
    if (data.accounts.length > 0) await upsertAccounts(itemId, data.accounts);

    await applyUpserts(data.added);
    await applyUpserts(data.modified);
    await applyRemovals(data.removed.map((r) => r.transaction_id));

    added += data.added.length;
    modified += data.modified.length;
    removed += data.removed.length;

    cursor = data.next_cursor;
    hasMore = data.has_more;

    // Persist the cursor after each page so a mid-loop failure resumes cleanly.
    await updateItemCursor(itemId, cursor);
  }

  return { added, modified, removed };
}

async function refreshBalances(accessToken: string): Promise<number> {
  const res = await plaid().accountsBalanceGet({ access_token: accessToken });
  for (const a of res.data.accounts) {
    await updateAccountBalance(
      a.account_id,
      a.balances.current === null || a.balances.current === undefined
        ? null
        : dollarsToCents(a.balances.current),
      a.balances.available === null || a.balances.available === undefined
        ? null
        : dollarsToCents(a.balances.available),
    );
  }
  return res.data.accounts.length;
}

async function refreshHoldings(accessToken: string): Promise<number> {
  try {
    const res = await plaid().investmentsHoldingsGet({ access_token: accessToken });
    const accountIds = res.data.accounts.map((a) => a.account_id);
    return await replaceHoldings(accountIds, res.data.holdings, res.data.securities);
  } catch (err: unknown) {
    // Items without the Investments product return PRODUCTS_NOT_SUPPORTED; skip.
    if (isSkippableInvestmentError(err)) return 0;
    throw err;
  }
}

const INVESTMENT_LOOKBACK_DAYS = 730; // Plaid's max transaction history window.
const INVESTMENT_PAGE_SIZE = 500; // Plaid max count per page.

/**
 * Pull investment transactions (buys/sells/dividends/fees) over the max history
 * window, paging on offset until every available row is fetched, then upsert.
 * Non-investment items are skipped; a not-yet-ready portfolio returns 0 and
 * fills in on a later sync (Plaid prepares investment history asynchronously).
 */
async function refreshInvestmentTransactions(accessToken: string): Promise<number> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - INVESTMENT_LOOKBACK_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);

  let offset = 0;
  let total = 0;
  let written = 0;

  try {
    do {
      const res = await plaid().investmentsTransactionsGet({
        access_token: accessToken,
        start_date: start,
        end_date: end,
        options: { count: INVESTMENT_PAGE_SIZE, offset },
      });
      total = res.data.total_investment_transactions;
      const page = res.data.investment_transactions;
      if (page.length === 0) break;
      written += await applyInvestmentTransactions(page, res.data.securities);
      offset += page.length;
    } while (offset < total);
  } catch (err: unknown) {
    if (isSkippableInvestmentError(err)) return 0;
    throw err;
  }
  return written;
}

/** True for items that legitimately have no investment data to pull. */
function isSkippableInvestmentError(err: unknown): boolean {
  const code = (err as { response?: { data?: { error_code?: string } } })?.response?.data
    ?.error_code;
  return (
    code === "PRODUCTS_NOT_SUPPORTED" ||
    code === "NO_INVESTMENT_ACCOUNTS" ||
    code === "PRODUCT_NOT_READY"
  );
}
