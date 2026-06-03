import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";

// A valid 32-byte base64 key for the test run, set before the module reads env.
beforeAll(() => {
  process.env.TOKEN_ENC_KEY = randomBytes(32).toString("base64");
  process.env.DATABASE_URL ??= "postgres://test";
});

describe("crypto AES-256-GCM", () => {
  it("round-trips a string", async () => {
    const { encrypt, decrypt } = await import("./index");
    const secret = "access-sandbox-1234-5678-token";
    const enc = encrypt(secret);
    expect(enc).not.toContain(secret);
    expect(enc.split(":")).toHaveLength(3);
    expect(decrypt(enc)).toBe(secret);
  });

  it("produces a different ciphertext each call (random IV)", async () => {
    const { encrypt, decrypt } = await import("./index");
    const a = encrypt("same-plaintext");
    const b = encrypt("same-plaintext");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same-plaintext");
    expect(decrypt(b)).toBe("same-plaintext");
  });

  it("round-trips unicode and empty strings", async () => {
    const { encrypt, decrypt } = await import("./index");
    for (const s of ["", "💳🔐 üñîçödé", "a".repeat(5000)]) {
      expect(decrypt(encrypt(s))).toBe(s);
    }
  });

  it("rejects tampered ciphertext (GCM auth)", async () => {
    const { encrypt, decrypt } = await import("./index");
    const enc = encrypt("tamper-me");
    const [iv, tag, data] = enc.split(":");
    const flipped = data!.slice(0, -2) + (data!.slice(-2) === "AA" ? "AB" : "AA");
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow();
  });

  it("rejects malformed input", async () => {
    const { decrypt } = await import("./index");
    expect(() => decrypt("not-valid")).toThrow();
  });
});
