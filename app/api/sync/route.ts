import { NextResponse } from "next/server";
import { syncAllItems } from "@/lib/plaid/sync";
import { seedCards } from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";

// POST /api/sync -> sync every item, then (re)seed cards and recompute the
// per-transaction optimal card + reward delta so reads stay a pure lookup.
export async function POST() {
  try {
    const results = await syncAllItems();
    await seedCards();
    const { updated } = await recomputeAndPersist();
    const ok = results.every((r) => !r.error);
    return NextResponse.json({ ok, results, rewardsComputed: updated }, { status: ok ? 200 : 207 });
  } catch (err) {
    console.error("sync error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
