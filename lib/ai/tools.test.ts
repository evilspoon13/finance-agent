import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// Set env before the module graph (which reaches lib/db/client) reads it.
beforeAll(() => {
  process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test";
});

/**
 * gpt-oss on Groq fills unused optional args with `null`, and Groq validates the
 * emitted args against the advertised JSON schema before we run — so optional
 * params must advertise null AND our zod must treat null as "absent". These
 * tests pin both halves so the malformed-tool-call 400s can't regress.
 */
describe("AI tool argument hardening", () => {
  it("coerces null optional dates to undefined", async () => {
    const { TOOL_MAP } = await import("./tools");
    const parsed = TOOL_MAP.get("get_spending")!.schema.parse({
      topic: null,
      from: null,
      to: null,
    }) as { topic?: string; from?: string; to?: string };
    expect(parsed.topic).toBeUndefined();
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });

  it("accepts a fully null-filled filter tool without throwing", async () => {
    const { TOOL_MAP } = await import("./tools");
    const schema = TOOL_MAP.get("get_top_merchants")!.schema;
    expect(() =>
      schema.parse({ topic: null, sort: null, from: null, to: null, limit: null }),
    ).not.toThrow();
  });

  it("advertises null in the JSON schema for optional params", async () => {
    const { toolSpecs } = await import("./tools");
    const spec = toolSpecs().find((s) => s.function.name === "get_top_merchants")!;
    const props = (spec.function.parameters as { properties: Record<string, { type?: unknown }> })
      .properties;
    expect(props.topic.type).toContain("null");
    expect(props.limit.type).toContain("null");
  });

  it("still accepts real values", async () => {
    const { TOOL_MAP } = await import("./tools");
    const parsed = TOOL_MAP.get("get_top_merchants")!.schema.parse({
      topic: "dining out",
      sort: "visits",
      limit: 5,
    }) as { topic?: string; sort?: string; limit?: number };
    expect(parsed.topic).toBe("dining out");
    expect(parsed.sort).toBe("visits");
    expect(parsed.limit).toBe(5);
  });
});
