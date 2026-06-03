import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyWebhook } from "@/lib/plaid/webhook-verify";
import { getItemByPlaidId, setItemStatusByPlaidId } from "@/lib/db/queries";
import { syncItem } from "@/lib/plaid/sync";

/**
 * POST /api/plaid/webhook
 *
 * Verifies the Plaid webhook JWT BEFORE acting on the payload, then:
 *  - SYNC_UPDATES_AVAILABLE (TRANSACTIONS): trigger a sync for that item.
 *  - ITEM_LOGIN_REQUIRED (ITEM): mark the item login_required.
 */

const payloadSchema = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string().optional(),
});

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signed = request.headers.get("plaid-verification");

  const verified = await verifyWebhook(rawBody, signed);
  if (!verified) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = payloadSchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { webhook_type, webhook_code, item_id } = payload;

  try {
    if (webhook_type === "TRANSACTIONS" && webhook_code === "SYNC_UPDATES_AVAILABLE" && item_id) {
      const item = await getItemByPlaidId(item_id);
      if (item) await syncItem(item);
    } else if (
      webhook_type === "ITEM" &&
      webhook_code === "ITEM_LOGIN_REQUIRED" &&
      item_id
    ) {
      await setItemStatusByPlaidId(item_id, "login_required");
    }
    // Other webhook types are acknowledged but not acted upon yet.
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("webhook handling error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Webhook handling failed" }, { status: 500 });
  }
}
