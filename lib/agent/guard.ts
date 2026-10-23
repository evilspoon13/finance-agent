import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { hasBearer } from "@/lib/auth/bearer";

/**
 * Gate for /api/agent/*: these routes sit outside the session login (see
 * proxy.ts) and authenticate with `Authorization: Bearer $AGENT_TOKEN`.
 * Returns a response to send back, or null when the caller may proceed.
 */
export function agentGuard(request: Request): NextResponse | null {
  const { AGENT_TOKEN, DATABASE_URL_READONLY } = env();
  if (!AGENT_TOKEN || !DATABASE_URL_READONLY) {
    return NextResponse.json({ error: "Agent access is not configured" }, { status: 503 });
  }
  if (!hasBearer(request, AGENT_TOKEN)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
