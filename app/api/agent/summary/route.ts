import { NextResponse } from "next/server";
import { agentGuard } from "@/lib/agent/guard";
import { buildAgentSummary } from "@/lib/agent/summary";

// GET /api/agent/summary -> the agent's starting picture (see docs/agent.md).
export async function GET(request: Request) {
  const denied = agentGuard(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await buildAgentSummary());
  } catch (err) {
    console.error("agent summary:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Summary failed" }, { status: 500 });
  }
}
