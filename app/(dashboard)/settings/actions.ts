"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRule, deleteRule } from "@/lib/db/rules-queries";
import { IGNORE_CATEGORY } from "@/lib/db/spend-sql";
import { BUDGETABLE_CATEGORIES } from "@/lib/category";

const ruleSchema = z.object({
  match: z.string().trim().min(2).max(100),
  category: z.enum([...BUDGETABLE_CATEGORIES, IGNORE_CATEGORY]),
});

function refresh() {
  revalidatePath("/settings");
  revalidatePath("/transactions");
  revalidatePath("/budgets");
}

export async function createRuleAction(formData: FormData): Promise<void> {
  const parsed = ruleSchema.safeParse({ match: formData.get("match"), category: formData.get("category") });
  if (!parsed.success) return;
  await createRule(parsed.data.match, parsed.data.category);
  refresh();
}

export async function deleteRuleAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await deleteRule(id);
  refresh();
}
