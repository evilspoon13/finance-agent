import { NextResponse } from "next/server";
import { createLinkToken } from "@/lib/plaid/link";

// POST /api/plaid/link-token -> { link_token }
export async function POST() {
  try {
    const linkToken = await createLinkToken();
    return NextResponse.json({ link_token: linkToken });
  } catch (err) {
    console.error("link-token error:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to create link token" }, { status: 500 });
  }
}
