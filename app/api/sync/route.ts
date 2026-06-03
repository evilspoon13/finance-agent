import { NextResponse } from "next/server";
import { syncAllItems } from "@/lib/plaid/sync";

// POST /api/sync -> run sync (transactions, balances, holdings) for every item.
export async function POST() {
  try {
    const results = await syncAllItems();
    const ok = results.every((r) => !r.error);
    return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (err) {
    console.error("sync error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
