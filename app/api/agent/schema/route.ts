import { NextResponse } from "next/server";
import { agentGuard } from "@/lib/agent/guard";
import { runReadonlyQuery } from "@/lib/agent/readonly-query";

const COLUMNS_SQL = `
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema = 'public' and table_name not like '\\_\\_%'
  order by table_name, ordinal_position`;

// GET /api/agent/schema -> {tables: {name: ["column type", ...]}}, so a run can
// write correct SQL first time. Runs as the read-only role, so columns it can't
// select (Plaid tokens) aren't listed.
export async function GET(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const result = await runReadonlyQuery(COLUMNS_SQL);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  const tables: Record<string, string[]> = {};
  for (const row of result.rows) {
    (tables[String(row.table_name)] ??= []).push(`${row.column_name} ${row.data_type}`);
  }
  return NextResponse.json({ tables, truncated: result.truncated });
}
