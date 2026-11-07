import { describe, expect, it } from "vitest";
import type { AgentBriefing } from "./schema";
import { mergeBriefings } from "./agent-queries";

const briefing = (id: string, kind: string, day: number) =>
  ({ id, kind, createdAt: new Date(Date.UTC(2026, 10, day)) }) as AgentBriefing;

describe("mergeBriefings", () => {
  it("keeps an older weekly that the recent dailies pushed out, newest first", () => {
    const recent = [briefing("d2", "daily", 8), briefing("d1", "daily", 7)];
    const latest = [briefing("d2", "daily", 8), briefing("w1", "weekly", 1)];
    expect(mergeBriefings(recent, latest).map((b) => b.id)).toEqual(["d2", "d1", "w1"]);
  });
});
