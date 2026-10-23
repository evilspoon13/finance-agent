"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authEnv } from "@/lib/env";
import { SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/auth/session";
import { clearFailures, isLockedOut, recordFailure } from "@/lib/auth/rate-limit";

export interface LoginState {
  error?: string;
}

/** Constant-time string compare (lengths may differ without leaking which byte). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Only same-site relative paths, so `next` can't bounce the user elsewhere. */
function safeNext(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("fly-client-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** HTTPS as the browser sees it (behind a TLS-terminating proxy like Fly's). */
async function isHttps(): Promise<boolean> {
  return (await headers()).get("x-forwarded-proto") === "https";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = await clientIp();
  if (isLockedOut(ip)) return { error: "Too many attempts. Try again in 15 minutes." };

  const { AUTH_USERNAME, AUTH_PASSWORD } = authEnv();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  // Evaluate both so a wrong username takes as long as a wrong password.
  const userOk = safeEqual(username, AUTH_USERNAME);
  const passOk = safeEqual(password, AUTH_PASSWORD);

  if (!userOk || !passOk) {
    recordFailure(ip);
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "Incorrect username or password." };
  }

  clearFailures(ip);
  (await cookies()).set(SESSION_COOKIE, await signSession(AUTH_USERNAME), {
    httpOnly: true,
    // Secure whenever served over HTTPS; plain HTTP (a LAN self-host) would
    // otherwise drop the cookie and make login impossible.
    secure: await isHttps(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
