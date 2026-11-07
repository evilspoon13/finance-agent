import { describe, expect, it } from "vitest";
import { detectRecurring, merchantKey, stepDate, type FlowRow } from "./recurring";

const row = (day: string, cents: number, over: Partial<FlowRow> = {}): FlowRow => ({
  accountId: "chk",
  accountName: "Checking",
  isCard: false,
  name: "LANDLORD LLC",
  merchantName: null,
  amountCents: cents,
  postedAt: new Date(`${day}T00:00:00Z`),
  pending: false,
  pfcDetailed: null,
  isSpend: true,
  ...over,
});
const now = new Date("2026-11-06T12:00:00Z");

describe("merchantKey", () => {
  it("groups ACH rows whose trace IDs differ", () => {
    const a = merchantKey("CHASE CREDIT CRD TYPE: EPAY ID: 9224 CO: CHASE CREDIT CRD ACH Trace 021000020966791", null);
    const b = merchantKey("CHASE CREDIT CRD TYPE: EPAY ID: 9224 CO: CHASE CREDIT CRD ACH Trace 021000024899210", null);
    expect(a).toBe("CHASE CREDIT CRD");
    expect(b).toBe(a);
  });
  it("uses the bank description when the merchant name changes between rows", () => {
    const name = "F and F Property TYPE: WEB PMTS ID: 5197";
    expect(merchantKey(name, "F And F Property")).toBe(merchantKey(name, "F&F Properties"));
  });
  it("prefers the clean merchant name and strips processor prefixes", () => {
    expect(merchantKey("TST* THE NEIGHBORHOOD COM", null)).toBe("THE NEIGHBORHOOD COM");
    expect(merchantKey("x", "Netflix")).toBe("NETFLIX");
  });
});

describe("detectRecurring", () => {
  it("finds a monthly bill and predicts the next date", () => {
    const [s] = detectRecurring([row("2026-08-01", 213000), row("2026-09-01", 213000), row("2026-10-01", 213000), row("2026-11-01", 213000)], now);
    expect(s).toMatchObject({ cadence: "monthly", status: "active", typicalCents: 213000 });
    expect(s!.nextDate.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("finds biweekly pay even when the amount moves", () => {
    const pay = { name: "ACME PAYROLL", pfcDetailed: "INCOME_SALARY" };
    const [s] = detectRecurring(
      [row("2026-09-16", -260000, pay), row("2026-09-30", -143300, pay), row("2026-10-14", -143300, pay), row("2026-10-28", -293200, pay)],
      now,
    );
    expect(s).toMatchObject({ cadence: "biweekly", direction: "in", isIncome: true, priceChange: null });
  });

  it("flags a price change and a stopped series", () => {
    const up = detectRecurring([row("2026-08-05", 1000), row("2026-09-05", 1000), row("2026-10-05", 1000), row("2026-11-05", 1300)], now)[0];
    expect(up!.priceChange).toEqual({ fromCents: 1000, toCents: 1300 });
    const gone = detectRecurring([row("2026-05-05", 1000), row("2026-06-05", 1000), row("2026-07-05", 1000)], now)[0];
    expect(gone!.status).toBe("stopped");
  });

  it("ignores irregular spending and pending rows", () => {
    expect(detectRecurring([row("2026-10-01", 1000), row("2026-10-03", 5000), row("2026-10-29", 700)], now)).toEqual([]);
    expect(detectRecurring([row("2026-08-05", 1000, { pending: true }), row("2026-09-05", 1000), row("2026-10-05", 1000)], now)).toEqual([]);
  });

  it("sees rent through a small side payment", () => {
    const [s] = detectRecurring(
      [row("2026-07-30", 204100), row("2026-08-05", 15900), row("2026-09-01", 213000), row("2026-09-30", 213000), row("2026-10-09", 4400), row("2026-10-30", 218200)],
      now,
    );
    expect(s).toMatchObject({ cadence: "monthly", status: "active" });
    expect(s!.nextDate.toISOString().slice(0, 10)).toBe("2026-11-30");
  });

  it("finds the current rhythm after an older irregular stretch", () => {
    const old = ["2026-04-20", "2026-04-22", "2026-05-02", "2026-05-03", "2026-06-20"].map((d) => row(d, 50000));
    const [s] = detectRecurring([...old, row("2026-07-27", 50000), row("2026-08-26", 50000), row("2026-09-28", 50000), row("2026-10-26", 50000)], now);
    expect(s).toMatchObject({ cadence: "monthly", status: "active" });
  });

  it("keeps one bill together when it moves to another card", () => {
    const card = (acct: string) => ({ accountId: acct, isCard: true, name: "GYM" });
    const series = detectRecurring([row("2026-08-17", 20500, card("a")), row("2026-09-16", 20500, card("a")), row("2026-10-16", 20500, card("b"))], now);
    expect(series).toHaveLength(1);
    expect(series[0]!.accountName).toBe("Credit cards");
  });

  it("treats a bill split across two payments on one day as one event", () => {
    const [s] = detectRecurring(
      [row("2026-08-01", 100000), row("2026-08-01", 113000), row("2026-09-01", 213000), row("2026-10-01", 213000)],
      now,
    );
    expect(s!.typicalCents).toBe(213000);
  });
});

describe("stepDate", () => {
  it("clamps to short months", () => {
    expect(stepDate(new Date("2026-01-31T00:00:00Z"), "monthly").toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
