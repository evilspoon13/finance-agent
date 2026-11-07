import { describe, expect, it } from "vitest";
import { auditTransactions, categorySpikes, type AuditRow } from "./audit";

const now = new Date("2026-11-06T12:00:00Z");
const row = (day: string, cents: number, over: Partial<AuditRow> = {}): AuditRow => ({
  accountName: "Card",
  name: "CORNER CAFE",
  merchantName: null,
  amountCents: cents,
  postedAt: new Date(`${day}T00:00:00Z`),
  pending: false,
  pfcPrimary: "FOOD_AND_DRINK",
  isSpend: true,
  ...over,
});
const audit = (rows: AuditRow[], ignore: string[] = []) =>
  auditTransactions(rows, { now, recentDays: 14, ignoreKeys: new Set(ignore) }).map((f) => f.type);

describe("auditTransactions", () => {
  it("flags the same charge twice within days, not a week apart", () => {
    expect(audit([row("2026-11-01", 4200), row("2026-11-02", 4200)])).toContain("duplicate");
    expect(audit([row("2026-10-25", 4200), row("2026-11-02", 4200)])).not.toContain("duplicate");
  });

  it("flags fees by category or wording", () => {
    expect(audit([row("2026-11-01", 3200, { name: "ACH OVERDRAFT FEE", pfcPrimary: "OTHER", isSpend: false })])).toContain("fee");
    expect(audit([row("2026-11-01", 900, { pfcPrimary: "BANK_FEES" })])).toContain("fee");
  });

  it("flags a charge far above the merchant's usual amount", () => {
    const usual = [row("2026-08-01", 1000), row("2026-09-01", 1100), row("2026-10-01", 900)];
    expect(audit([...usual, row("2026-11-01", 5000)])).toContain("amount_spike");
    expect(audit([...usual, row("2026-11-01", 1500)])).not.toContain("amount_spike");
  });

  it("doesn't flag a shop that often charges this much", () => {
    const varied = [row("2026-08-01", 1000), row("2026-08-10", 1100), row("2026-09-01", 900), row("2026-09-20", 9000)];
    expect(audit([...varied, row("2026-11-01", 5000)])).not.toContain("amount_spike");
  });

  it("flags large first-time charges but not small ones", () => {
    expect(audit([row("2026-11-01", 15000)])).toContain("first_time_large");
    expect(audit([row("2026-11-01", 3000)])).toEqual([]);
  });

  it("flags a pending row left behind", () => {
    expect(audit([row("2026-10-20", 213000, { pending: true })])).toContain("stale_pending");
    expect(audit([row("2026-11-05", 213000, { pending: true })])).toEqual([]);
    expect(audit([row("2026-10-20", 100, { pending: true }), row("2026-10-21", 200, { pending: true, name: "OTHER" })])).toEqual(["stale_pending"]);
  });

  it("skips merchants the user already explained", () => {
    expect(audit([row("2026-11-01", 15000)], ["CORNER CAFE"])).toEqual([]);
  });
});

describe("categorySpikes", () => {
  it("flags a category well above its average", () => {
    const past = [{ FOOD: 50000 }, { FOOD: 60000 }];
    expect(categorySpikes({ FOOD: 90000 }, past)).toHaveLength(1);
    expect(categorySpikes({ FOOD: 60000 }, past)).toEqual([]);
  });
});
