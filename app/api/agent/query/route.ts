import { NextResponse } from "next/server";
import { z } from "zod";
import { agentGuard } from "@/lib/agent/guard";
import { runReadonlyQuery } from "@/lib/agent/readonly-query";

const bodySchema = z.object({ sql: z.string().min(1).max(20_000) });

// POST /api/agent/query {sql} -> read-only SQL for the agent's follow-up digging.
// SQL errors come back as 200 {ok:false,error} so the agent can fix and retry.
export async function POST(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Body must be {"sql": "..."}' }, { status: 400 });
  return NextResponse.json(await runReadonlyQuery(parsed.data.sql));
}
