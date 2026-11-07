import { describe, expect, it } from "vitest";
import { decideKnowledgeWrite, type ExistingKnowledge } from "./knowledge";

const row = (id: string, status: string, source: string, body = "old"): ExistingKnowledge => ({ id, body, source, status });

describe("decideKnowledgeWrite", () => {
  it("holds a guess or a paraphrased reply for review, even with nothing stored", () => {
    expect(decideKnowledgeWrite("inferred", "plans to hold QCOM", [])).toMatchObject({ status: "pending_review" });
    expect(decideKnowledgeWrite("reported", "said X", [])).toMatchObject({ status: "pending_review" });
  });

  it("publishes an observed fact and retires what it replaces", () => {
    expect(decideKnowledgeWrite("observed", "new", [row("a", "active", "observed")])).toEqual({
      outcome: "write",
      status: "active",
      supersede: ["a"],
    });
  });

  it("never overwrites what the user said", () => {
    expect(decideKnowledgeWrite("observed", "new", [row("a", "active", "user")])).toEqual({
      outcome: "write",
      status: "pending_review",
      supersede: [],
    });
  });

  it("replaces its own unreviewed draft instead of piling up", () => {
    expect(decideKnowledgeWrite("inferred", "new", [row("p", "pending_review", "inferred")])).toMatchObject({
      status: "pending_review",
      supersede: ["p"],
    });
  });

  it("won't bring back something the user rejected", () => {
    expect(decideKnowledgeWrite("inferred", "old", [row("r", "rejected", "inferred")])).toMatchObject({ outcome: "noop" });
  });

  it("ignores a repeat of what's already stored", () => {
    expect(decideKnowledgeWrite("observed", "old", [row("a", "active", "user")])).toMatchObject({ outcome: "noop" });
  });
});
