"use server";

import { revalidatePath } from "next/cache";
import { createManagedCard, updateManagedCard, deleteManagedCard } from "@/lib/db/rewards-queries";
import { recomputeAndPersist } from "@/lib/rewards/compute";
import { parseCardForm } from "@/lib/rewards/card-form";

async function refresh() {
  await recomputeAndPersist();
  revalidatePath("/cards");
  revalidatePath("/rewards");
}

export async function createCardAction(formData: FormData): Promise<void> {
  const input = parseCardForm(formData);
  if (!input) return;
  await createManagedCard(input);
  await refresh();
}

export async function updateCardAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const input = parseCardForm(formData);
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
