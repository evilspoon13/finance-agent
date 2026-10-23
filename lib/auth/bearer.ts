import { timingSafeEqual } from "node:crypto";

/**
 * True when the request carries `Authorization: Bearer <secret>`. Constant-time,
 * and always false for an unset secret, so an unconfigured endpoint stays shut.
 */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
