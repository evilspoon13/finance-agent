"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setP2PCategory, ignoreP2P } from "@/lib/db/p2p-queries";
import { BUDGETABLE_CATEGORIES } from "@/lib/category";

const categorizeSchema = z.object({
  id: z.string().min(1),
  category: z.enum(BUDGETABLE_CATEGORIES),
  memo: z.string().trim().max(120).optional(),
});

/** Assign a budget category (+ optional note) to one P2P payment. */
export async function categorizeP2PAction(formData: FormData): Promise<void> {
  const parsed = categorizeSchema.safeParse({
    id: formData.get("id"),
    category: formData.get("category"),
    memo: formData.get("memo") ?? undefined,
  });
  if (!parsed.success) return;
  const { id, category, memo } = parsed.data;
  await setP2PCategory(id, category, memo && memo.length > 0 ? memo : null);
  revalidatePath("/review");
  revalidatePath("/budgets");
  revalidatePath("/");
}

/** Dismiss a P2P payment as not-spending so it leaves the review list. */
export async function ignoreP2PAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await ignoreP2P(id);
  revalidatePath("/review");
  revalidatePath("/budgets");
  revalidatePath("/");
}
