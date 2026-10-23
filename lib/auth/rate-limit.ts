/**
 * In-memory login throttle: at most MAX_FAILURES failed attempts per client IP
 * per WINDOW_MS. Per-process, which is fine for a single-machine deployment;
 * it resets on restart, so the fixed delay in the login action still applies.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

const failures = new Map<string, number[]>();

function recent(ip: string, now: number): number[] {
  const list = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(ip, list);
  else failures.delete(ip);
  return list;
}

export function isLockedOut(ip: string, now = Date.now()): boolean {
  return recent(ip, now).length >= MAX_FAILURES;
}

export function recordFailure(ip: string, now = Date.now()): void {
  failures.set(ip, [...recent(ip, now), now]);
}

export function clearFailures(ip: string): void {
  failures.delete(ip);
}
