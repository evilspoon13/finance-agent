import { and, gte, lte, eq, desc, sql, type SQL } from "drizzle-orm";
import { db } from "../client";
import { accounts, transactions, cards } from "../schema";
import { P2P_OUT_DETAILED, P2P_IN_DETAILED } from "../spend-sql";
import { displayName, type SpendingFilter } from "./shared";

export interface P2PTxn {
  name: string;
  amountCents: number; // >0 sent, <0 received
  postedAt: Date | null;
}
export interface P2PNet {
  outCents: number; // total sent (>=0)
  inCents: number; // total received (<=0)
  netCents: number; // out + in = net out-of-pocket
  outCount: number;
  inCount: number;
  transactions: P2PTxn[];
}

/** Time/account scoping shared by the P2P + excluded-bucket helpers (no spend filter). */
function timeAccountClauses(f: SpendingFilter): SQL[] {
  const clauses: SQL[] = [sql`${transactions.pending} = false`];
  if (f.from) clauses.push(gte(transactions.postedAt, f.from));
  if (f.to) clauses.push(lte(transactions.postedAt, f.to));
  if (f.accountId) clauses.push(eq(transactions.accountId, f.accountId));
  return clauses;
}

/**
 * Net peer-to-peer spending: money sent via apps minus money received back
 * (reimbursements). Only app-to-app is netted — cross-channel reimbursements
 * (e.g. a bank deposit) are intentionally NOT offset here. See the budgets page.
 */
export async function peerToPeerNet(f: SpendingFilter = {}): Promise<P2PNet> {
  const clauses = timeAccountClauses(f);
  clauses.push(sql`${transactions.pfcDetailed} in (${P2P_OUT_DETAILED}, ${P2P_IN_DETAILED})`);
  // Categorized/ignored outgoing payments have been handled — exclude them so
  // they aren't counted a second time here.
  clauses.push(sql`${transactions.userCategory} is null`);
  const rows = await db
    .select({
      name: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
    })
    .from(transactions)
    .where(and(...clauses))
    .orderBy(sql`${transactions.amountCents} desc`);

  let outCents = 0;
  let inCents = 0;
  let outCount = 0;
  let inCount = 0;
  for (const r of rows) {
    if (r.amountCents > 0) {
      outCents += r.amountCents;
      outCount++;
    } else if (r.amountCents < 0) {
      inCents += r.amountCents;
      inCount++;
    }
  }
  return { outCents, inCents, netCents: outCents + inCents, outCount, inCount, transactions: rows };
}

export interface UncategorizedP2P {
  id: string;
  name: string; // merchant/counterparty, e.g. the person paid
  amountCents: number; // > 0 (outflow)
  postedAt: Date | null;
  accountName: string;
}

/**
 * Outgoing peer-to-peer app payments the user hasn't reviewed yet
 * (user_category IS NULL). These are the rows the categorize screen works
 * through. Only outflows — received money stays a reimbursement (see spec).
 */
export async function listUncategorizedP2P(limit = 100): Promise<UncategorizedP2P[]> {
  return db
    .select({
      id: transactions.id,
      name: sql<string>`coalesce(${transactions.merchantName}, ${transactions.name})`,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
      accountName: displayName,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(cards, eq(cards.accountId, transactions.accountId))
    .where(
      and(
        eq(transactions.pfcDetailed, P2P_OUT_DETAILED),
        eq(transactions.pending, false),
        sql`${transactions.amountCents} > 0`,
        sql`${transactions.userCategory} is null`,
      ),
    )
    .orderBy(desc(transactions.postedAt))
    .limit(limit);
}

/** How many outgoing P2P payments still need a category (drives the banner). */
export async function countUncategorizedP2P(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(
      and(
        eq(transactions.pfcDetailed, P2P_OUT_DETAILED),
        eq(transactions.pending, false),
        sql`${transactions.amountCents} > 0`,
        sql`${transactions.userCategory} is null`,
      ),
    );
  return row?.n ?? 0;
}
