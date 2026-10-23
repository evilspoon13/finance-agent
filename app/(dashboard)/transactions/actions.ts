"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setTransactionOverrides } from "@/lib/db/override-queries";
import { createRule } from "@/lib/db/rules-queries";
import { IGNORE_CATEGORY, REIMBURSEMENT_CATEGORY } from "@/lib/db/spend-sql";
import { BUDGETABLE_CATEGORIES } from "@/lib/category";

/** Every value the category override may take ("" = use Plaid's category). */
const OVERRIDE_CATEGORIES = [...BUDGETABLE_CATEGORIES, IGNORE_CATEGORY, REIMBURSEMENT_CATEGORY] as const;

/** Absent or blank form fields mean "no override". */
const blankToNull = (v: unknown) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v);

const schema = z.object({
  id: z.string().min(1),
  category: z.preprocess(blankToNull, z.enum(OVERRIDE_CATEGORIES).nullable()),
  memo: z.preprocess(blankToNull, z.string().trim().max(200).nullable()),
  budgetMonth: z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}$/).nullable()),
  amortizeMonths: z.preprocess(blankToNull, z.coerce.number().int().min(1).max(60).nullable()),
  reimbursed: z.preprocess(blankToNull, z.coerce.number().min(0).max(1_000_000).nullable()),
  ruleMatch: z.preprocess(blankToNull, z.string().trim().min(2).max(100).nullable()),
});

export interface SaveResult {
  ok: boolean;
  error?: string;
  ruleTagged?: number;
}

/** Save the transaction editor: all overrides at once, plus an optional merchant rule. */
export async function saveTransactionAction(formData: FormData): Promise<SaveResult> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Check the highlighted values and try again." };
  const p = parsed.data;

  const reimbursedCents = p.reimbursed ? Math.round(p.reimbursed * 100) : null;
  await setTransactionOverrides(p.id, {
    userCategory: p.category,
    userMemo: p.memo,
    budgetMonth: p.budgetMonth ? `${p.budgetMonth}-01` : null,
    amortizeMonths: p.amortizeMonths && p.amortizeMonths > 1 ? p.amortizeMonths : null,
    reimbursedCents: reimbursedCents || null,
  });

  let ruleTagged: number | undefined;
  if (p.ruleMatch && p.category) ruleTagged = await createRule(p.ruleMatch, p.category);

  revalidatePath("/transactions");
  revalidatePath("/budgets");
  revalidatePath("/review");
  revalidatePath("/settings");
  return { ok: true, ruleTagged };
}
