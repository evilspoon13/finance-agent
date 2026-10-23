import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Single-user auth gate. Every request (pages, server actions, API routes)
 * needs a valid session cookie, except the login page and the two machine
 * endpoints, which authenticate themselves: the Plaid webhook (Plaid-signed
 * JWT, see lib/plaid/webhook-verify.ts) and the scheduled sync (bearer
 * CRON_SECRET). The session is a stateless signed JWT, so this check is
 * complete on its own — no DB lookup.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/plaid/webhook", "/api/cron/sync"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's static assets and the public icon/manifest files.
  matcher: ["/((?!_next/static|_next/image|icon.svg|apple-icon|manifest.webmanifest).*)"],
};
