import { afterAll, beforeEach, expect, it } from "vitest";
import { closeAuction } from "../../backend/src/modules/auction/auction.service.js";
import { createAuction, createProduct, createUser, describeDb, prisma, resetDb, runExpiredAuctionSweep, startExpiredAuctionScheduler } from "../helpers/integration.js";

describeDb("concurrency safety", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates exactly one order for concurrent closeAuction calls", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id, null, { highestBidderId: buyer.user.id, currentPrice: 180 });

    await expect(Promise.all(Array.from({ length: 5 }, () => closeAuction(auction.id, new Date())))).resolves.toHaveLength(5);

    const orderCount = await prisma.order.count({ where: { auctionId: auction.id } });
    expect(orderCount).toBe(1);
  });

  it("settles using final highest bid when a bid is committed before close", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id, null);

    await prisma.$transaction([
      prisma.bid.create({ data: { auctionId: auction.id, userId: buyer.user.id, amount: 220 } }),
      prisma.auction.update({ where: { id: auction.id }, data: { currentPrice: 220, highestBidderId: buyer.user.id } })
    ]);
    await Promise.all([closeAuction(auction.id, new Date()), closeAuction(auction.id, new Date())]);

    const order = await prisma.order.findUnique({ where: { auctionId: auction.id } });
    expect(order?.amount).toBe(220);
  });
});

describeDb("expired auction scheduler", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("ends expired running auctions and creates orders for winners", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id, null, {
      endTime: new Date(Date.now() - 1_000),
      highestBidderId: buyer.user.id,
      currentPrice: 180
    });

    await runExpiredAuctionSweep();

    const ended = await prisma.auction.findUnique({ where: { id: auction.id }, include: { order: true } });
    expect(ended?.status).toBe("ENDED");
    expect(ended?.order?.amount).toBe(180);
    expect(ended?.endTime?.getTime()).toBe(auction.endTime?.getTime());
  });

  it("does not create orders for expired auctions without a highest bidder", async () => {
    const host = await createUser("HOST");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id, null, {
      endTime: new Date(Date.now() - 1_000),
      highestBidderId: null
    });

    await runExpiredAuctionSweep();

    await expect(prisma.order.findUnique({ where: { auctionId: auction.id } })).resolves.toBeNull();
  });

  it("returns the same interval when scheduler is already running", () => {
    const first = startExpiredAuctionScheduler(10_000);
    const second = startExpiredAuctionScheduler(10_000);
    expect(second).toBe(first);
    clearInterval(first);
  });
});
