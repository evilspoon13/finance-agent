"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setActionStatus } from "@/lib/db/agent-queries";

const schema = z.object({ id: z.string().min(1), status: z.enum(["open", "done", "dismissed"]) });

/** Close (or reopen) one of the agent's follow-ups. */
export async function setActionStatusAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({ id: formData.get("id"), status: formData.get("status") });
  if (!parsed.success) return;
  await setActionStatus(parsed.data.id, parsed.data.status, parsed.data.status === "open" ? undefined : "Closed in the app");
  revalidatePath("/briefings");
}
