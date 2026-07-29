import { describe, it, expect } from "vitest";
import { resolveTopic } from "./topics";

/**
 * The topic layer is what makes "groceries" mean groceries ($440.70) and not the
 * whole Food & Drink category ($958.20). These pin the mappings that matter.
 */
describe("resolveTopic", () => {
  it("maps 'groceries' to the groceries subcategory only", () => {
    expect(resolveTopic("groceries")?.detailed).toEqual(["FOOD_AND_DRINK_GROCERIES"]);
  });

  it("maps dining aliases to restaurant + fast food + coffee (no groceries)", () => {
    for (const alias of ["dining out", "restaurants", "eating out", "restaurant"]) {
      const d = resolveTopic(alias)?.detailed ?? [];
      expect(d).toContain("FOOD_AND_DRINK_RESTAURANT");
      expect(d).toContain("FOOD_AND_DRINK_FAST_FOOD");
      expect(d).toContain("FOOD_AND_DRINK_COFFEE");
      expect(d).not.toContain("FOOD_AND_DRINK_GROCERIES");
    }
  });

  it("maps general 'food' to the whole primary category", () => {
    const s = resolveTopic("food");
    expect(s?.primary).toBe("FOOD_AND_DRINK");
    expect(s?.detailed).toBeUndefined();
  });

  it("resolves plural aliases and other topics", () => {
    expect(resolveTopic("supermarkets")?.detailed).toEqual(["FOOD_AND_DRINK_GROCERIES"]);
    expect(resolveTopic("gas")?.detailed).toEqual(["TRANSPORTATION_GAS"]);
    expect(resolveTopic("uber")?.detailed).toEqual(["TRANSPORTATION_TAXIS_AND_RIDE_SHARES"]);
  });

  it("accepts raw pfc codes as a fallback", () => {
    expect(resolveTopic("FOOD_AND_DRINK_GROCERIES")?.detailed).toEqual(["FOOD_AND_DRINK_GROCERIES"]);
    expect(resolveTopic("TRANSPORTATION")?.primary).toBe("TRANSPORTATION");
  });

  it("returns null for unknown topics", () => {
    expect(resolveTopic("blockchain")).toBeNull();
    expect(resolveTopic("")).toBeNull();
  });
});
