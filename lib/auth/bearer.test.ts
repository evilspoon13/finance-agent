import { describe, it, expect } from "vitest";
import { hasBearer } from "./bearer";

const req = (auth?: string) => new Request("https://x/", { headers: auth ? { authorization: auth } : {} });

describe("hasBearer", () => {
  it("accepts the exact token", () => {
    expect(hasBearer(req("Bearer s3cret-token"), "s3cret-token")).toBe(true);
  });
  it("rejects a wrong, missing or differently-sized token", () => {
    expect(hasBearer(req("Bearer nope"), "s3cret-token")).toBe(false);
    expect(hasBearer(req(), "s3cret-token")).toBe(false);
    expect(hasBearer(req("s3cret-token"), "s3cret-token")).toBe(false);
  });
  it("stays shut when no secret is configured", () => {
    expect(hasBearer(req("Bearer "), undefined)).toBe(false);
    expect(hasBearer(req("Bearer "), "")).toBe(false);
  });
});
