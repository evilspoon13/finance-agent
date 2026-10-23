import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncAll } from "@/lib/plaid/sync";

// POST /api/cron/sync -> the scheduled daily sync. Outside the session gate
// (proxy.ts), so it authenticates with `Authorization: Bearer $CRON_SECRET`.
export async function POST(request: Request) {
  const secret = env().CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await syncAll();
    const failed = results.filter((r) => r.error);
    for (const r of failed) console.error(`cron sync ${r.institution}: ${r.error}`);
    return NextResponse.json({ ok: failed.length === 0, items: results.length, failed: failed.length });
  } catch (err) {
    console.error("cron sync error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
