import { describe, it, expect } from "vitest";
import { isLockedOut, recordFailure, clearFailures } from "./rate-limit";

describe("login rate limit", () => {
  it("locks out after 5 failures and clears on success", () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 4; i++) recordFailure(ip, 1_000);
    expect(isLockedOut(ip, 1_000)).toBe(false);
    recordFailure(ip, 1_000);
    expect(isLockedOut(ip, 1_000)).toBe(true);
    clearFailures(ip);
    expect(isLockedOut(ip, 1_000)).toBe(false);
  });

  it("forgets failures after 15 minutes", () => {
    const ip = "203.0.113.8";
    for (let i = 0; i < 5; i++) recordFailure(ip, 0);
    expect(isLockedOut(ip, 15 * 60 * 1000 + 1)).toBe(false);
  });
});
