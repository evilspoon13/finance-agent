import { describe, expect, it } from "vitest";
import { profileSchema } from "./profile";
import { checkProposal, portfolioView, scoreProposal, washSaleRisks, type Position } from "./portfolio";

const rules = profileSchema.parse({
  stocks: { coreTickers: ["VOO", "VXUS"], excludedTickers: ["QCOM"], higherBarSectors: ["semiconductors"] },
}).stocks;
const pos = (ticker: string | null, valueCents: number, over: Partial<Position> = {}): Position => ({
  ticker,
  accountKind: "taxable",
  valueCents,
  costBasisCents: valueCents,
  ...over,
});
const view = portfolioView([pos("VOO", 90_000_00), pos("ABC", 5_000_00), pos("VXUS", 5_000_00), pos("CUR:USD", 1)], rules);
const buy = (ticker: string, amountCents: number, over = {}) =>
  checkProposal({ ticker, action: "buy", amountCents, fundedBy: "new_money", ...over }, view, rules, []);

describe("portfolioView", () => {
  it("splits core from individual stocks and leaves out cash", () => {
    expect(view.totalCents).toBe(100_000_00);
    expect(view.sleevePct).toBe(5);
    expect(view.tickers[0]).toMatchObject({ ticker: "VOO", core: true });
  });
  it("works out room against a total that grows with the buy", () => {
    expect(view.sleeveRoomCents).toBe(5_555_55);
    expect(buy("NEW", 3_000_00).errors).toEqual([]);
  });
});

describe("checkProposal", () => {
  it("always lets core funds through", () => {
    expect(checkProposal({ ticker: "VOO", action: "buy", amountCents: 50_000_00 }, view, rules, []).errors).toEqual([]);
  });
  it("blocks the excluded ticker, but not selling it", () => {
    expect(buy("QCOM", 100_00).errors[0]).toContain("excluded");
    expect(checkProposal({ ticker: "QCOM", action: "sell", amountCents: 100_00 }, view, rules, []).errors).toEqual([]);
  });
  it("enforces the per-name cap", () => {
    expect(buy("NEW", 3_100_00).errors).toEqual([]);
    expect(buy("NEW", 3_200_00).errors[0]).toContain("3% limit");
  });
  it("enforces the sleeve cap", () => {
    const full = portfolioView([pos("VOO", 90_000_00), pos("A", 3_000_00), pos("B", 3_000_00), pos("C", 3_000_00), pos("D", 1_000_00)], rules);
    expect(checkProposal({ ticker: "E", action: "buy", amountCents: 1_000_00, fundedBy: "new_money" }, full, rules, []).errors[0]).toContain("10% limit");
  });
  it("refuses stocks funded by selling core", () => {
    expect(buy("NEW", 100_00, { fundedBy: "selling_core" }).errors[0]).toContain("new money");
  });
  it("makes a higher-bar sector justify itself", () => {
    expect(buy("NEW", 100_00, { sector: "semiconductors" }).errors[0]).toContain("sectorJustification");
    expect(buy("NEW", 100_00, { sector: "semiconductors", sectorJustification: "Not correlated because..." }).errors).toEqual([]);
  });
  it("warns about wash sales", () => {
    const r = checkProposal({ ticker: "VOO", action: "sell", amountCents: 100_00 }, view, rules, ["VOO"]);
    expect(r.warnings[0]).toContain("wash sale");
  });
});

describe("washSaleRisks", () => {
  it("flags taxable losses in a fund bought recently in any account", () => {
    const held = [pos("VOO", 90, { costBasisCents: 100 }), pos("VXUS", 90, { costBasisCents: 100 }), pos("VTI", 90, { costBasisCents: 100, accountKind: "roth" })];
    expect(washSaleRisks(held, [{ ticker: "VOO", date: "2026-11-01" }, { ticker: "VTI", date: "2026-11-01" }])).toEqual(["VOO"]);
  });
});

describe("scoreProposal", () => {
  it("compares against the benchmark", () => {
    expect(scoreProposal({ entryCents: 100, benchEntryCents: 100, nowCents: 110, benchNowCents: 104 })).toEqual({ returnPct: 10, benchmarkPct: 4, excessPct: 6 });
  });
  it("waits for prices", () => {
    expect(scoreProposal({ entryCents: null, benchEntryCents: 100, nowCents: 110, benchNowCents: 104 })).toBeNull();
  });
});
