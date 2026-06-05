"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createManagedCard,
  updateManagedCard,
  deleteManagedCard,
  type CardInput,
} from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";
import { REWARD_CATEGORY_TAGS } from "@/lib/rewards/reward-categories";

const pctSchema = z.coerce.number().min(0).max(100);
const pctToBps = (pct: number) => Math.round(pct * 100);

/** Build a CardInput from form fields: label, accountId, baseRate, bonus_<tag>. */
function parseCardInput(formData: FormData): CardInput | null {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return null;

  const base = pctSchema.safeParse(formData.get("baseRate"));
  if (!base.success) return null;

  const accountIdRaw = String(formData.get("accountId") ?? "").trim();
  const accountId = accountIdRaw || null;

  const bonuses: Record<string, number> = {};
  for (const tag of REWARD_CATEGORY_TAGS) {
    const raw = formData.get(`bonus_${tag}`);
    if (raw == null || String(raw).trim() === "") continue;
    const parsed = pctSchema.safeParse(raw);
    if (parsed.success && parsed.data > 0) bonuses[tag] = pctToBps(parsed.data);
  }

  return { label, accountId, network: "card", baseBps: pctToBps(base.data), bonuses };
}

async function refresh() {
  await recomputeAndPersist();
  revalidatePath("/cards");
  revalidatePath("/rewards");
}

export async function createCardAction(formData: FormData): Promise<void> {
  const input = parseCardInput(formData);
  if (!input) return;
  await createManagedCard(input);
  await refresh();
}

export async function updateCardAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const input = parseCardInput(formData);
  if (!id || !input) return;
  await updateManagedCard(id, input);
  await refresh();
}

export async function deleteCardAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await deleteManagedCard(id);
  await refresh();
}
