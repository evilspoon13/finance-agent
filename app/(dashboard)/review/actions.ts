"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setTransactionOverrides } from "@/lib/db/override-queries";
import { IGNORE_CATEGORY } from "@/lib/db/spend-sql";
import { BUDGETABLE_CATEGORIES } from "@/lib/category";

const categorizeSchema = z.object({
  id: z.string().min(1),
  category: z.enum(BUDGETABLE_CATEGORIES),
  memo: z.string().trim().max(120).optional(),
});

function refresh() {
  revalidatePath("/review");
  revalidatePath("/budgets");
  revalidatePath("/transactions");
}

/** Assign a budget category (+ optional note) to one P2P payment. */
export async function categorizeP2PAction(formData: FormData): Promise<void> {
  const parsed = categorizeSchema.safeParse({
    id: formData.get("id"),
    category: formData.get("category"),
    memo: formData.get("memo") ?? undefined,
  });
  if (!parsed.success) return;
  const { id, category, memo } = parsed.data;
  await setTransactionOverrides(id, { userCategory: category, userMemo: memo || null });
  refresh();
}

/** Dismiss a P2P payment as not-spending so it leaves the review list. */
export async function ignoreP2PAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await setTransactionOverrides(id, { userCategory: IGNORE_CATEGORY, userMemo: null });
  refresh();
}
