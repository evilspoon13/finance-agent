import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentGuard } from "./guard";

const full = "f".repeat(32);
const research = "r".repeat(32);
const req = (token?: string) => new Request("https://x.test", { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://x");
  vi.stubEnv("TOKEN_ENC_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubEnv("DATABASE_URL_READONLY", "postgres://ro");
  vi.stubEnv("AGENT_TOKEN", full);
  vi.stubEnv("AGENT_RESEARCH_TOKEN", research);
});
afterEach(() => vi.unstubAllEnvs());

describe("agentGuard", () => {
  it("lets the full token through everywhere", () => {
    expect(agentGuard(req(full))).toBeNull();
    expect(agentGuard(req(full), "research")).toBeNull();
  });
  it("keeps the research token off financial routes", () => {
    expect(agentGuard(req(research))?.status).toBe(403);
    expect(agentGuard(req(research), "research")).toBeNull();
  });
  it("rejects anything else", () => {
    expect(agentGuard(req())?.status).toBe(401);
    expect(agentGuard(req("wrong"), "research")?.status).toBe(401);
  });
});
