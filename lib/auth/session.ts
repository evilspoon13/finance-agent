import { SignJWT, jwtVerify } from "jose";

/**
 * Stateless single-user session: a signed JWT in an httpOnly cookie. Verified
 * by proxy.ts on every request (no DB lookup), so this module must stay free
 * of DB imports.
 */

export const SESSION_COOKIE = "session";
export const SESSION_DAYS = 30;

function key(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(secret);
}

export async function signSession(username: string): Promise<string> {
  return new SignJWT({ sub: username })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key());
}

/** True when the token is a valid, unexpired session for the configured user. */
export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.sub === process.env.AUTH_USERNAME;
  } catch {
    return false;
  }
}
