import { NextResponse } from "next/server";
import { z } from "zod";
import { exchangePublicToken, newItemId } from "@/lib/plaid/link";
import { fetchAccounts } from "@/lib/plaid/accounts";
import { encrypt } from "@/lib/crypto";
import { upsertItem, upsertAccounts } from "@/lib/db/queries";

const bodySchema = z.object({ public_token: z.string().min(1) });

// POST /api/plaid/exchange -> exchange public_token, persist item + accounts (encrypted token)
export async function POST(request: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const { accessToken, itemId: plaidItemId } = await exchangePublicToken(parsed.public_token);

    // Fetch accounts + institution name before persisting so we write the item once.
    const fetched = await fetchAccounts(accessToken);

    // Persist the item with the access token encrypted at rest.
    const item = await upsertItem({
      id: newItemId(),
      plaidItemId,
      institutionName: fetched.institutionName,
      accessTokenEnc: encrypt(accessToken),
    });
    const count = await upsertAccounts(item.id, fetched.accounts);

    return NextResponse.json({
      item_id: item.id,
      institution: fetched.institutionName,
      accounts: count,
    });
  } catch (err) {
    console.error("exchange error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to exchange public token" }, { status: 500 });
  }
}
