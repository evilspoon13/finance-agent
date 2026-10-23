import { describe, it, expect } from "vitest";
import { formatDiscordMessage } from "./discord";

describe("formatDiscordMessage", () => {
  it("keeps a short message whole, with title and link", () => {
    const m = formatDiscordMessage("Daily check", "All on track.", "https://claude.ai/code/x");
    expect(m).toBe("**Daily check**\nAll on track.\n\n[Continue in Claude →](<https://claude.ai/code/x>)");
  });

  it("cuts a long body to Discord's 2,000-character limit at a line break", () => {
    const body = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const m = formatDiscordMessage("Weekly", body, "https://claude.ai/code/x");
    expect(m.length).toBeLessThanOrEqual(2000);
    expect(m).toContain("…(full briefing in the app)");
    expect(m).toMatch(/line \d+\n…\(full briefing/);
    expect(m.endsWith("(<https://claude.ai/code/x>)")).toBe(true);
  });
});
