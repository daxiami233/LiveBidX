import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    auction: {
      updateMany: vi.fn(),
      findUnique: vi.fn()
    },
    order: {
      create: vi.fn()
    },
    liveSession: {
      findUnique: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("../../backend/src/config/prisma.js", () => ({ prisma: prismaMock }));

const { closeAuction, nextAvailableProductId, advanceLiveAfterAuction } = await import("../../backend/src/modules/auction/auction.service.js");

function runTransactionWithMockTx() {
  prismaMock.$transaction.mockImplementation((callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
}

describe("auction.service closeAuction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTransactionWithMockTx();
  });

  it("ends a running auction with a highest bidder and creates one order with currentPrice", async () => {
    const auction = {
      id: "auction-1",
      productId: "product-1",
      highestBidderId: "buyer-1",
      currentPrice: 8800,
      order: null
    };
    prismaMock.auction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auction.findUnique.mockResolvedValueOnce(auction).mockResolvedValueOnce({ ...auction, status: "ENDED" });
    prismaMock.order.create.mockResolvedValue({ id: "order-1" });

    const result = await closeAuction("auction-1");

    expect(prismaMock.auction.updateMany).toHaveBeenCalledWith({
      where: { id: "auction-1", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "ENDED" }
    });
    expect(prismaMock.order.create).toHaveBeenCalledWith({
      data: {
        auctionId: "auction-1",
        productId: "product-1",
        buyerId: "buyer-1",
        amount: 8800
      }
    });
    expect(result).toEqual({ ...auction, status: "ENDED" });
  });

  it("ends a running auction without bids and does not create an order", async () => {
    prismaMock.auction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auction.findUnique
      .mockResolvedValueOnce({ id: "auction-1", productId: "product-1", highestBidderId: null, currentPrice: 1000, order: null })
      .mockResolvedValueOnce({ id: "auction-1", status: "ENDED" });

    await closeAuction("auction-1");

    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("is idempotent when auction is already ended", async () => {
    const ended = { id: "auction-1", status: "ENDED", order: { id: "order-1" } };
    prismaMock.auction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.auction.findUnique.mockResolvedValueOnce(ended);

    const result = await closeAuction("auction-1");

    expect(result).toEqual(ended);
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("ignores cancelled auctions", async () => {
    const cancelled = { id: "auction-1", status: "CANCELLED", order: null };
    prismaMock.auction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.auction.findUnique.mockResolvedValueOnce(cancelled);

    await closeAuction("auction-1");

    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("does not throw or create duplicate orders when called concurrently", async () => {
    const auction = { id: "auction-1", productId: "product-1", highestBidderId: "buyer-1", currentPrice: 5000, order: null };
    prismaMock.auction.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    prismaMock.auction.findUnique.mockResolvedValue(auction);
    prismaMock.order.create.mockResolvedValue({ id: "order-1" });

    await expect(Promise.all(Array.from({ length: 5 }, () => closeAuction("auction-1")))).resolves.toHaveLength(5);
    expect(prismaMock.order.create).toHaveBeenCalledTimes(1);
  });

  it("uses overrideEndTime when provided", async () => {
    const overrideEndTime = new Date("2026-01-01T00:00:00.000Z");
    prismaMock.auction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auction.findUnique
      .mockResolvedValueOnce({ id: "auction-1", highestBidderId: null, order: null })
      .mockResolvedValueOnce({ id: "auction-1", status: "ENDED" });

    await closeAuction("auction-1", overrideEndTime);

    expect(prismaMock.auction.updateMany).toHaveBeenCalledWith({
      where: { id: "auction-1", status: { in: ["PENDING", "RUNNING"] } },
      data: { status: "ENDED", endTime: overrideEndTime }
    });
  });

  it("keeps natural expiry endTime unchanged when overrideEndTime is omitted", async () => {
    prismaMock.auction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auction.findUnique
      .mockResolvedValueOnce({ id: "auction-1", highestBidderId: null, order: null })
      .mockResolvedValueOnce({ id: "auction-1", status: "ENDED" });

    await closeAuction("auction-1");

    expect(prismaMock.auction.updateMany.mock.calls[0][0].data).toEqual({ status: "ENDED" });
  });

  it("returns null for a missing auction", async () => {
    prismaMock.auction.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.auction.findUnique.mockResolvedValueOnce(null);

    await expect(closeAuction("missing")).resolves.toBeNull();
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it("does not recreate an order when one already exists", async () => {
    prismaMock.auction.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.auction.findUnique
      .mockResolvedValueOnce({ id: "auction-1", highestBidderId: "buyer-1", order: { id: "order-1" } })
      .mockResolvedValueOnce({ id: "auction-1", status: "ENDED", order: { id: "order-1" } });

    await closeAuction("auction-1");

    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
});

describe("auction.service nextAvailableProductId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockLive(productIds: string[], auctions: Array<{ productId: string; status: string }>) {
    prismaMock.liveSession.findUnique.mockResolvedValue({
      products: productIds.map((productId) => ({ productId })),
      auctions
    });
  }

  it("returns the next unauctioned product", async () => {
    mockLive(["A", "B", "C"], [{ productId: "A", status: "ENDED" }]);
    await expect(nextAvailableProductId("live-1", "A")).resolves.toBe("B");
  });

  it("skips ended products", async () => {
    mockLive(["A", "B", "C"], [{ productId: "A", status: "ENDED" }, { productId: "B", status: "ENDED" }]);
    await expect(nextAvailableProductId("live-1", "A")).resolves.toBe("C");
  });

  it("skips running products", async () => {
    mockLive(["A", "B", "C"], [{ productId: "A", status: "ENDED" }, { productId: "B", status: "RUNNING" }]);
    await expect(nextAvailableProductId("live-1", "A")).resolves.toBe("C");
  });

  it("allows cancelled products to be selected again", async () => {
    mockLive(["A", "B", "C"], [{ productId: "A", status: "ENDED" }, { productId: "B", status: "CANCELLED" }]);
    await expect(nextAvailableProductId("live-1", "A")).resolves.toBe("B");
  });

  it("returns null when every product is unavailable", async () => {
    mockLive(["A", "B", "C"], [
      { productId: "A", status: "ENDED" },
      { productId: "B", status: "ENDED" },
      { productId: "C", status: "ENDED" }
    ]);
    await expect(nextAvailableProductId("live-1", "C")).resolves.toBeNull();
  });

  it("wraps around to an earlier unauctioned product", async () => {
    mockLive(["A", "B", "C"], [{ productId: "C", status: "ENDED" }]);
    await expect(nextAvailableProductId("live-1", "C")).resolves.toBe("A");
  });

  it("returns null for a single completed product", async () => {
    mockLive(["A"], [{ productId: "A", status: "ENDED" }]);
    await expect(nextAvailableProductId("live-1", "A")).resolves.toBeNull();
  });

  it("returns null when live session does not exist", async () => {
    prismaMock.liveSession.findUnique.mockResolvedValue(null);
    await expect(nextAvailableProductId("missing", "A")).resolves.toBeNull();
  });
});

describe("auction.service advanceLiveAfterAuction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears active auction and advances to the next product", async () => {
    prismaMock.liveSession.findUnique.mockResolvedValue({
      products: ["A", "B"].map((productId) => ({ productId })),
      auctions: [{ productId: "A", status: "ENDED" }]
    });
    prismaMock.liveSession.update.mockResolvedValue({ id: "live-1", activeAuctionProductId: null, currentProductId: "B" });

    await advanceLiveAfterAuction("live-1", "A");

    expect(prismaMock.liveSession.update).toHaveBeenCalledWith({
      where: { id: "live-1" },
      data: { activeAuctionProductId: null, currentProductId: "B" }
    });
  });

  it("clears currentProductId when every product is finished", async () => {
    prismaMock.liveSession.findUnique.mockResolvedValue({
      products: [{ productId: "A" }],
      auctions: [{ productId: "A", status: "ENDED" }]
    });
    prismaMock.liveSession.update.mockResolvedValue({ id: "live-1", activeAuctionProductId: null, currentProductId: null });

    await advanceLiveAfterAuction("live-1", "A");

    expect(prismaMock.liveSession.update).toHaveBeenCalledWith({
      where: { id: "live-1" },
      data: { activeAuctionProductId: null, currentProductId: null }
    });
  });
});
