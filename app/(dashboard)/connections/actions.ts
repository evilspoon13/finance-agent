"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getItemById } from "@/lib/db/queries";
import { createManualAccount, deleteItem, setManualBalance, MANUAL_TYPES } from "@/lib/db/manual-accounts";
import { decrypt } from "@/lib/crypto";
import { plaid } from "@/lib/plaid/client";
import { isManualItem } from "@/lib/plaid/sync";
import { recomputeAndPersist } from "@/lib/rewards/compute";
import { recordNetWorthSnapshot } from "@/lib/db/net-worth-history";

async function refresh() {
  await recordNetWorthSnapshot();
  revalidatePath("/", "layout");
}

/**
 * Remove a linked institution: revoke the Plaid access token, then delete the
 * item with all its accounts and transactions. Re-adding it later starts a
 * fresh link (and pulls whatever history the institution provides).
 */
export async function removeItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const item = id ? await getItemById(id) : undefined;
  if (!item) return;
  if (!isManualItem(item)) {
    try {
      await plaid().itemRemove({ access_token: decrypt(item.accessTokenEnc) });
    } catch (err) {
      // Already gone at Plaid (or unreachable): still drop it locally.
      console.error(`Plaid itemRemove for ${item.institutionName}:`, err instanceof Error ? err.message : err);
    }
  }
  await deleteItem(item.id);
  await recomputeAndPersist();
  await refresh();
}

const manualSchema = z.object({
  institution: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  type: z.enum(MANUAL_TYPES),
  subtype: z.string().trim().max(40).optional(),
  balance: z.coerce.number().min(0).max(100_000_000),
});

export async function createManualAccountAction(formData: FormData): Promise<void> {
  const parsed = manualSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { balance, subtype, ...rest } = parsed.data;
  await createManualAccount({ ...rest, subtype: subtype || null, balanceCents: Math.round(balance * 100) });
  await refresh();
}

const balanceSchema = z.object({
  accountId: z.string().startsWith("manual_"),
  balance: z.coerce.number().min(0).max(100_000_000),
});

export async function setManualBalanceAction(formData: FormData): Promise<void> {
  const parsed = balanceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await setManualBalance(parsed.data.accountId, Math.round(parsed.data.balance * 100));
  await refresh();
}
