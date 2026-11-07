"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { answerQuestion, setActionStatus } from "@/lib/db/agent-queries";
import { decideProposal } from "@/lib/db/research-queries";

const schema = z.object({ id: z.string().min(1), status: z.enum(["open", "done", "dismissed"]) });

/** Close (or reopen) one of the agent's follow-ups. */
export async function setActionStatusAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return;
  await setActionStatus(parsed.data.id, parsed.data.status, parsed.data.status === "open" ? undefined : "Closed in the app");
  revalidatePath("/briefings");
}

const answerSchema = z.object({ id: z.string().min(1), answer: z.string().trim().min(1).max(4_000) });

/** Answer one of the agent's questions. Stored word for word, so every later run sees it. */
export async function answerQuestionAction(formData: FormData): Promise<void> {
  const parsed = answerSchema.safeParse({ id: formData.get("id"), answer: formData.get("answer") });
  if (!parsed.success) return;
  await answerQuestion(parsed.data.id, parsed.data.answer);
  revalidatePath("/briefings");
  revalidatePath("/knowledge");
}

const decisionSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["accepted", "declined"]),
  note: z.string().trim().max(1_000).optional(),
});

/** Record what the user did with a proposal. The agent never trades. */
export async function decideProposalAction(formData: FormData): Promise<void> {
  const parsed = decisionSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) return;
  await decideProposal(parsed.data.id, parsed.data.status, parsed.data.note);
  revalidatePath("/briefings");
}
