import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { hasBearer } from "@/lib/auth/bearer";

/**
 * Gate for /api/agent/*: these routes sit outside the session login (see
 * proxy.ts) and authenticate with a bearer token. Two tokens, two reaches:
 *  - AGENT_TOKEN: everything. Used by runs with financial data and no web tools.
 *  - AGENT_RESEARCH_TOKEN: research routes only. Used by web-facing runs, which
 *    must never reach financial data, since a web page could try to steer them.
 * Returns a response to send back, or null when the caller may proceed.
 */
export function agentGuard(request: Request, scope: "full" | "research" = "full"): NextResponse | null {
  const { AGENT_TOKEN, AGENT_RESEARCH_TOKEN, DATABASE_URL_READONLY } = env();
  if (!AGENT_TOKEN || !DATABASE_URL_READONLY) {
    return NextResponse.json({ error: "Agent access is not configured" }, { status: 503 });
  }
  if (hasBearer(request, AGENT_TOKEN)) return null;
  if (AGENT_RESEARCH_TOKEN && hasBearer(request, AGENT_RESEARCH_TOKEN)) {
    return scope === "research" ? null : NextResponse.json({ error: "Forbidden for the research token" }, { status: 403 });
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
