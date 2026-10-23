import { NextResponse } from "next/server";
import { syncAll } from "@/lib/plaid/sync";

// POST /api/sync -> sync every item, then the derived steps (rules, cards,
// rewards, net-worth snapshot). Behind the session gate; see proxy.ts.
export async function POST() {
  try {
    const results = await syncAll();
    const ok = results.every((r) => !r.error);
    return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (err) {
    console.error("sync error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
