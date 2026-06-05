"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createBudget, updateBudget, deleteBudget, upsertBudget } from "@/lib/db/budget-queries";
import { dollarsToCents } from "@/lib/money";
import { BUDGETABLE_CATEGORIES } from "@/lib/category";

const createSchema = z.object({
  category: z.enum(BUDGETABLE_CATEGORIES),
  limitDollars: z.coerce.number().positive().max(1_000_000),
});

export async function createBudgetAction(formData: FormData): Promise<void> {
  const parsed = createSchema.safeParse({
    category: formData.get("category"),
    limitDollars: formData.get("limitDollars"),
  });
  if (!parsed.success) return;
  await createBudget(parsed.data.category, dollarsToCents(parsed.data.limitDollars));
  revalidatePath("/budgets");
}

const updateSchema = z.object({
  id: z.string().min(1),
  limitDollars: z.coerce.number().positive().max(1_000_000),
});

export async function updateBudgetAction(formData: FormData): Promise<void> {
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    limitDollars: formData.get("limitDollars"),
  });
  if (!parsed.success) return;
  await updateBudget(parsed.data.id, dollarsToCents(parsed.data.limitDollars));
  revalidatePath("/budgets");
}

export async function deleteBudgetAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id === "string" && id) {
    await deleteBudget(id);
    revalidatePath("/budgets");
  }
}

const applySchema = z.object({
  items: z
    .array(
      z.object({
        category: z.enum(BUDGETABLE_CATEGORIES),
        limitCents: z.coerce.number().int().positive().max(100_000_000),
      }),
    )
    .min(1)
    .max(BUDGETABLE_CATEGORIES.length),
});

/** Apply a reviewed AI budget plan: upsert one limit per category. */
export async function applyBudgetsAction(
  items: { category: string; limitCents: number }[],
): Promise<{ ok: boolean; applied: number; error?: string }> {
  const parsed = applySchema.safeParse({ items });
  if (!parsed.success) return { ok: false, applied: 0, error: "Invalid budget plan" };

  for (const item of parsed.data.items) {
    await upsertBudget(item.category, item.limitCents);
  }
  revalidatePath("/budgets");
  return { ok: true, applied: parsed.data.items.length };
}
