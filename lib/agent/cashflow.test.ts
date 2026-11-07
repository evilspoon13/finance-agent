import { describe, expect, it } from "vitest";
import { forecastAccount, nextPayDate } from "./cashflow";
import type { RecurringSeries } from "./recurring";

const now = new Date("2026-11-06T12:00:00Z");
const series = (key: string, next: string, cents: number, over: Partial<RecurringSeries> = {}): RecurringSeries => ({
  key,
  accountId: "chk",
  accountName: "Checking",
  direction: "out",
  cadence: "monthly",
  typicalCents: cents,
  lastCents: cents,
  lastDate: new Date("2026-10-30T00:00:00Z"),
  nextDate: new Date(`${next}T00:00:00Z`),
  count: 4,
  status: "active",
  isNew: false,
  isCardPayment: false,
  isIncome: false,
  isSpend: true,
  priceChange: null,
  ...over,
});
const base = {
  account: { id: "chk", name: "Checking", balanceCents: 200000, pendingOutCents: 0 },
  cards: [],
  now,
  horizonDays: 45,
  bufferCents: 50000,
  savings: { name: "Savings", balanceCents: 1000000 },
};

describe("forecastAccount", () => {
  it("finds the low point, its cause and the transfer that fixes it", () => {
    const f = forecastAccount({ ...base, series: [series("RENT", "2026-11-30", 213000)] });
    expect(f.lowestCents).toBe(-13000);
    expect(f.lowestDate).toBe("2026-11-30");
    expect(f.cause).toBe("RENT");
    expect(f.transfer).toEqual({ amountCents: 70000, from: "Savings", byDate: "2026-11-28" });
  });

  it("stays quiet when the account covers everything", () => {
    const f = forecastAccount({ ...base, series: [series("GYM", "2026-11-15", 20000)] });
    expect(f.transfer).toBeNull();
  });

  it("takes pending charges off the starting balance", () => {
    const f = forecastAccount({ ...base, account: { ...base.account, pendingOutCents: 180000 }, series: [] });
    expect(f.startCents).toBe(20000);
    expect(f.transfer?.amountCents).toBe(30000);
  });

  it("counts card balances once, as an estimated payment rather than the old payment series", () => {
    const f = forecastAccount({
      ...base,
      series: [series("CHASE", "2026-11-09", 130000, { isCardPayment: true })],
      cards: [{ issuer: "Chase", balanceCents: 233800, payDay: 9, payerAccountId: "chk" }],
    });
    expect(f.events).toHaveLength(1);
    expect(f.events[0]?.cents).toBe(-233800);
  });

  it("counts a paycheck before a bill on the same day", () => {
    const f = forecastAccount({
      ...base,
      account: { ...base.account, balanceCents: 60000 },
      series: [series("RENT", "2026-11-20", 50000), series("PAY", "2026-11-20", 140000, { direction: "in", cadence: "biweekly" })],
    });
    expect(f.lowestCents).toBe(60000);
  });

  it("leaves a pass-through account alone when nothing is due from it", () => {
    const f = forecastAccount({
      ...base,
      account: { ...base.account, balanceCents: 57 },
      series: [series("PAY", "2026-11-11", 147200, { direction: "in", cadence: "biweekly" })],
    });
    expect(f.transfer).toBeNull();
  });

  it("ignores stopped series and other accounts", () => {
    const f = forecastAccount({
      ...base,
      series: [series("OLD", "2026-11-20", 999999, { status: "stopped" }), series("X", "2026-11-20", 999999, { accountId: "other" })],
    });
    expect(f.events).toEqual([]);
  });
});

describe("nextPayDate", () => {
  it("rolls to next month once the day has passed and clamps short months", () => {
    expect(nextPayDate(5, now).toISOString().slice(0, 10)).toBe("2026-12-05");
    expect(nextPayDate(9, now).toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(nextPayDate(31, now).toISOString().slice(0, 10)).toBe("2026-11-30");
  });
});
