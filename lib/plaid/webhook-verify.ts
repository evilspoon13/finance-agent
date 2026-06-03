import { createHash, timingSafeEqual } from "node:crypto";
import {
  importJWK,
  jwtVerify,
  decodeProtectedHeader,
  type JWK,
  type JWTVerifyResult,
} from "jose";
import { plaid } from "./client";

/**
 * Verify a Plaid webhook per Plaid's spec:
 *  1. Read the JWT from the `Plaid-Verification` header (alg must be ES256).
 *  2. Fetch the verification key (JWK) for the JWT's `kid`.
 *  3. Verify the JWT signature.
 *  4. Confirm the SHA-256 of the raw request body matches the JWT's
 *     `request_body_sha256` claim (constant-time compare).
 *  5. Reject tokens older than 5 minutes.
 *
 * Returns true only if every check passes.
 */

const MAX_AGE_SECONDS = 5 * 60;

// Cache verification keys by kid (they are stable and rotate rarely).
const keyCache = new Map<string, JWK>();

async function getVerificationKey(kid: string): Promise<JWK | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  try {
    const res = await plaid().webhookVerificationKeyGet({ key_id: kid });
    const jwk = res.data.key as unknown as JWK;
    keyCache.set(kid, jwk);
    return jwk;
  } catch {
    return null;
  }
}

export async function verifyWebhook(rawBody: string, signedJwt: string | null): Promise<boolean> {
  if (!signedJwt) return false;

  let header;
  try {
    header = decodeProtectedHeader(signedJwt);
  } catch {
    return false;
  }
  if (header.alg !== "ES256" || !header.kid) return false;

  const jwk = await getVerificationKey(header.kid);
  if (!jwk) return false;

  let verified: JWTVerifyResult;
  try {
    const key = await importJWK(jwk, "ES256");
    verified = await jwtVerify(signedJwt, key, { algorithms: ["ES256"] });
  } catch {
    return false;
  }

  const claims = verified.payload as { request_body_sha256?: string; iat?: number };

  // Freshness: reject stale tokens (replay protection).
  if (typeof claims.iat !== "number" || Date.now() / 1000 - claims.iat > MAX_AGE_SECONDS) {
    return false;
  }

  // Body integrity: the claim must match the SHA-256 of the exact raw body.
  if (!claims.request_body_sha256) return false;
  const computed = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(claims.request_body_sha256);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  return true;
}
