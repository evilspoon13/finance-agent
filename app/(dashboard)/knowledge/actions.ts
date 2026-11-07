"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { KNOWLEDGE_TOPICS } from "@/lib/agent/knowledge";
import { confirmKnowledge, rejectKnowledge, saveUserKnowledge } from "@/lib/db/agent-queries";

const factSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
  topic: z.enum(KNOWLEDGE_TOPICS),
  body: z.string().trim().min(1).max(4_000),
});

const refresh = () => revalidatePath("/knowledge");

/** Add a fact or edit one. Either way it's now the user's own, so the agent can't overwrite it. */
export async function saveFactAction(formData: FormData): Promise<void> {
  const parsed = factSchema.safeParse({ slug: formData.get("slug"), topic: formData.get("topic"), body: formData.get("body") });
  if (!parsed.success) return;
  await saveUserKnowledge(parsed.data);
  refresh();
}

export async function confirmFactAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await confirmKnowledge(id);
  refresh();
}

export async function rejectFactAction(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await rejectKnowledge(id);
  refresh();
}
