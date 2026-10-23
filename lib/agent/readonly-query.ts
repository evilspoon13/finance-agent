import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * Ad-hoc SQL for the agent, defended in depth:
 *  1. The connection logs in as a read-only role (DATABASE_URL_READONLY) that
 *     can't write anything or read Plaid tokens — the guarantee lives in Postgres.
 *  2. Every query runs in a READ ONLY transaction with a 5s statement timeout.
 *  3. The query is wrapped as a subquery and sent as one prepared statement,
 *     so stacked statements ("select 1; delete ...") are a syntax error.
 * Results are capped at MAX_ROWS.
 */

export const MAX_ROWS = 500;

let client: ReturnType<typeof postgres> | null = null;

function readonlyClient() {
  const url = env().DATABASE_URL_READONLY;
  if (!url) throw new Error("DATABASE_URL_READONLY is not set");
  // Use a direct (non-pooler) URL: queries go out as named prepared statements.
  client ??= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 15 });
  return client;
}

export type QueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }
  | { ok: false; error: string };

export async function runReadonlyQuery(query: string): Promise<QueryResult> {
  const body = query.trim().replace(/;+\s*$/, "");
  if (!body) return { ok: false, error: "Empty query" };
  if (!/^(select|with)\b/i.test(body)) return { ok: false, error: "Only SELECT / WITH queries are allowed" };

  try {
    const rows = await readonlyClient().begin("read only", async (tx) => {
      await tx`set local statement_timeout = '5s'`;
      return tx.unsafe(`select * from (\n${body}\n) as agent_query limit ${MAX_ROWS + 1}`, [], { prepare: true });
    });
    const list = Array.from(rows) as Record<string, unknown>[];
    const truncated = list.length > MAX_ROWS;
    const kept = truncated ? list.slice(0, MAX_ROWS) : list;
    return {
      ok: true,
      columns: rows.columns?.map((c) => c.name) ?? Object.keys(kept[0] ?? {}),
      rows: kept,
      rowCount: kept.length,
      truncated,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
