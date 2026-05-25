import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateBidUpdate } from "../../backend/src/modules/auction/bidRules.js";
import { assertRateLimit, resetRateLimits } from "../../backend/src/realtime/auctionGateway.js";

describe("auction bid rules", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("accepts amount exactly at currentPrice + minIncrement", () => {
    const result = calculateBidUpdate({ amount: 150, currentPrice: 100, minIncrement: 50, now });
    expect(result.amount).toBe(150);
  });

  it("rejects amount below currentPrice + minIncrement", () => {
    expect(() => calculateBidUpdate({ amount: 149, currentPrice: 100, minIncrement: 50, now })).toThrow("出价需不低于 150");
  });

  it("clips amount to capPrice", () => {
    const result = calculateBidUpdate({ amount: 300, currentPrice: 100, minIncrement: 50, capPrice: 220, now });
    expect(result.amount).toBe(220);
  });

  it("rejects when clipped amount is still below minimum amount", () => {
    expect(() => calculateBidUpdate({ amount: 300, currentPrice: 100, minIncrement: 50, capPrice: 120, now })).toThrow("出价需不低于 150");
  });

  it("does not clip when capPrice is absent", () => {
    const result = calculateBidUpdate({ amount: 300, currentPrice: 100, minIncrement: 50, now });
    expect(result.amount).toBe(300);
  });

  it("does not extend when outside the auto extension window", () => {
    const endTime = new Date(now.getTime() + 20_000);
    const result = calculateBidUpdate({ amount: 150, currentPrice: 100, minIncrement: 50, endTime, autoExtendSec: 15, now });
    expect(result.nextEndTime).toEqual(endTime);
  });

  it("extends when inside the auto extension window", () => {
    const endTime = new Date(now.getTime() + 5_000);
    const result = calculateBidUpdate({ amount: 150, currentPrice: 100, minIncrement: 50, endTime, autoExtendSec: 15, now });
    expect(result.nextEndTime).toEqual(new Date(endTime.getTime() + 15_000));
  });

  it("does not extend when autoExtendSec is zero", () => {
    const endTime = new Date(now.getTime() + 5_000);
    const result = calculateBidUpdate({ amount: 150, currentPrice: 100, minIncrement: 50, endTime, autoExtendSec: 0, now });
    expect(result.nextEndTime).toEqual(endTime);
  });
});

describe("auctionGateway assertRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    resetRateLimits();
  });

  afterEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it("allows calls within the limit", () => {
    expect(() => {
      assertRateLimit("key", 2, 1000, "too many");
      assertRateLimit("key", 2, 1000, "too many");
    }).not.toThrow();
  });

  it("throws after the limit is exceeded in the same window", () => {
    assertRateLimit("key", 2, 1000, "too many");
    assertRateLimit("key", 2, 1000, "too many");

    expect(() => assertRateLimit("key", 2, 1000, "too many")).toThrow("too many");
  });

  it("resets after the time window expires", () => {
    assertRateLimit("key", 1, 1000, "too many");
    vi.advanceTimersByTime(1001);

    expect(() => assertRateLimit("key", 1, 1000, "too many")).not.toThrow();
  });

  it("keeps different keys independent", () => {
    assertRateLimit("A", 1, 1000, "too many");

    expect(() => assertRateLimit("A", 1, 1000, "too many")).toThrow("too many");
    expect(() => assertRateLimit("B", 1, 1000, "too many")).not.toThrow();
  });
});
