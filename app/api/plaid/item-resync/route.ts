import { NextResponse } from "next/server";
import { z } from "zod";
import { getItemById, setItemStatusById } from "@/lib/db/queries";
import { syncItemById } from "@/lib/plaid/sync";
import { seedCards } from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";

const bodySchema = z.object({ itemId: z.string().min(1) });

// POST /api/plaid/item-resync -> after a successful Link update, mark the item
// healthy and resync it (backfills newly available history), then recompute.
export async function POST(request: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const item = await getItemById(parsed.itemId);
    if (!item) return NextResponse.json({ error: "Unknown item" }, { status: 404 });

    await setItemStatusById(item.id, "good");
    const result = await syncItemById(item.id);
    await seedCards();
    await recomputeAndPersist();
    return NextResponse.json({ ok: !result.error, result });
  } catch (err) {
    console.error("item-resync error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Resync failed" }, { status: 500 });
  }
}
