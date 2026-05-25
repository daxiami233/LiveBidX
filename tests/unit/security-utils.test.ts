import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createToken, verifyToken } from "../../backend/src/utils/token.js";
import { hashPassword, verifyPassword } from "../../backend/src/utils/password.js";

function sign(encoded: string) {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "livebidx-dev-secret").update(encoded).digest("base64url");
}

function tokenFromPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

describe("utils/token", () => {
  it("creates a signed token containing userId, role and exp", () => {
    const token = createToken({ userId: "user-1", role: "CUSTOMER" });
    const [encoded, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));

    expect(encoded).toBeTruthy();
    expect(signature).toBeTruthy();
    expect(payload.userId).toBe("user-1");
    expect(payload.role).toBe("CUSTOMER");
    expect(typeof payload.exp).toBe("number");
  });

  it("sets token expiry to about seven days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const token = createToken({ userId: "user-1", role: "HOST" });
    const payload = verifyToken(token);

    expect(payload?.exp).toBe(Date.now() + 1000 * 60 * 60 * 24 * 7);
    vi.useRealTimers();
  });

  it("verifies a valid token", () => {
    const token = createToken({ userId: "user-1", role: "CUSTOMER" });
    expect(verifyToken(token)).toMatchObject({ userId: "user-1", role: "CUSTOMER" });
  });

  it("rejects expired tokens", () => {
    const token = tokenFromPayload({ userId: "user-1", role: "CUSTOMER", exp: Date.now() - 1 });
    expect(verifyToken(token)).toBeNull();
  });

  it("rejects tampered signatures", () => {
    const token = createToken({ userId: "user-1", role: "CUSTOMER" });
    expect(verifyToken(`${token.slice(0, -2)}xx`)).toBeNull();
  });

  it("rejects tampered payloads", () => {
    const token = createToken({ userId: "user-1", role: "CUSTOMER" });
    const [, signature] = token.split(".");
    const encoded = Buffer.from(JSON.stringify({ userId: "user-2", role: "CUSTOMER", exp: Date.now() + 1000 })).toString("base64url");

    expect(verifyToken(`${encoded}.${signature}`)).toBeNull();
  });

  it("rejects malformed or empty tokens", () => {
    expect(verifyToken("not-a-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});

describe("utils/password", () => {
  it("returns non-empty hash and salt", () => {
    const result = hashPassword("secret123");
    expect(result.hash).toBeTruthy();
    expect(result.salt).toBeTruthy();
  });

  it("uses random salt for the same password", () => {
    const first = hashPassword("secret123");
    const second = hashPassword("secret123");

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("verifies the correct password", () => {
    const { hash, salt } = hashPassword("secret123");
    expect(verifyPassword("secret123", hash, salt)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const { hash, salt } = hashPassword("secret123");
    expect(verifyPassword("wrong-password", hash, salt)).toBe(false);
  });

  it("rejects a forged salt", () => {
    const { hash } = hashPassword("secret123");
    expect(verifyPassword("secret123", hash, "forged-salt")).toBe(false);
  });
});
