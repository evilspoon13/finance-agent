import { NextResponse } from "next/server";
import { z } from "zod";
import { createUpdateLinkToken } from "@/lib/plaid/link";
import { getItemById } from "@/lib/db/queries";
import { decrypt } from "@/lib/crypto";

const bodySchema = z.object({ itemId: z.string().min(1) });

// POST /api/plaid/link-token/update -> update-mode link_token for an item
// (used to repair login_required and to backfill deeper transaction history).
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
    const linkToken = await createUpdateLinkToken(decrypt(item.accessTokenEnc));
    return NextResponse.json({ link_token: linkToken });
  } catch (err) {
    console.error("update link-token error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to create update link token" }, { status: 500 });
  }
}
