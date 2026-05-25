import request from "supertest";
import { afterAll, beforeEach, expect, it } from "vitest";
import { app, auth, createAuction, createLive, createProduct, createUser, describeDb, prisma, resetDb } from "../helpers/integration.js";

describeDb("auction API", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates auction from product config and updates live active product", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id, { durationSec: 180, capPrice: 260, autoExtendSec: 20 });
    const live = await createLive(user.id, [product.id], { status: "LIVE", currentProductId: product.id });

    const response = await request(app).post("/api/auctions").set(auth(token)).send({ productId: product.id, liveSessionId: live.id }).expect(201);

    expect(response.body.auction.capPrice).toBe(260);
    expect(response.body.auction.autoExtendSec).toBe(20);
    const persistedLive = await prisma.liveSession.findUnique({ where: { id: live.id } });
    expect(persistedLive?.activeAuctionProductId).toBe(product.id);
    const durationMs = new Date(response.body.auction.endTime).getTime() - new Date(response.body.auction.startTime).getTime();
    expect(durationMs).toBe(180_000);
  });

  it("honors durationSeconds override", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id, { durationSec: 180 });
    const live = await createLive(user.id, [product.id], { status: "LIVE", currentProductId: product.id });

    const response = await request(app).post("/api/auctions").set(auth(token)).send({ productId: product.id, liveSessionId: live.id, durationSeconds: 60 }).expect(201);
    const durationMs = new Date(response.body.auction.endTime).getTime() - new Date(response.body.auction.startTime).getTime();
    expect(durationMs).toBe(60_000);
  });

  it("creates standalone auctions without live-session side effects", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);

    const response = await request(app).post("/api/auctions").set(auth(token)).send({ productId: product.id }).expect(201);

    expect(response.body.auction.liveSessionId).toBeNull();
    expect(response.body.auction.productId).toBe(product.id);
    expect(response.body.auction.status).toBe("RUNNING");
  });

  it("rejects invalid auction creation cases", async () => {
    const host = await createUser("HOST");
    const customer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const otherProduct = await createProduct(host.user.id);
    const archived = await createProduct(host.user.id, { status: "ARCHIVED" });
    const live = await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id });

    await request(app).post("/api/auctions").set(auth(customer.token)).send({ productId: product.id, liveSessionId: live.id }).expect(403);
    await request(app).post("/api/auctions").set(auth(host.token)).send({ productId: archived.id, liveSessionId: live.id }).expect(404);
    await request(app).post("/api/auctions").set(auth(host.token)).send({ productId: otherProduct.id, liveSessionId: live.id }).expect(400);

    await prisma.liveProduct.create({ data: { liveSessionId: live.id, productId: otherProduct.id, sortOrder: 1 } });
    await request(app).post("/api/auctions").set(auth(host.token)).send({ productId: otherProduct.id, liveSessionId: live.id }).expect(409);
    await prisma.liveSession.update({ where: { id: live.id }, data: { activeAuctionProductId: product.id } });
    await request(app).post("/api/auctions").set(auth(host.token)).send({ productId: product.id, liveSessionId: live.id }).expect(409);
  });

  it("blocks ended products but allows cancelled products to reopen in the same live", async () => {
    const { user, token } = await createUser("HOST");
    const endedProduct = await createProduct(user.id);
    const cancelledProduct = await createProduct(user.id);
    const live = await createLive(user.id, [endedProduct.id, cancelledProduct.id], { status: "LIVE", currentProductId: endedProduct.id });
    await createAuction(user.id, endedProduct.id, live.id, { status: "ENDED" });
    await createAuction(user.id, cancelledProduct.id, live.id, { status: "CANCELLED" });

    await request(app).post("/api/auctions").set(auth(token)).send({ productId: endedProduct.id, liveSessionId: live.id }).expect(409);
    await prisma.liveSession.update({ where: { id: live.id }, data: { currentProductId: cancelledProduct.id } });
    await request(app).post("/api/auctions").set(auth(token)).send({ productId: cancelledProduct.id, liveSessionId: live.id }).expect(201);
  });

  it("ends auctions with and without orders and advances live queue", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const first = await createProduct(host.user.id);
    const second = await createProduct(host.user.id);
    const live = await createLive(host.user.id, [first.id, second.id], { status: "LIVE", currentProductId: first.id, activeAuctionProductId: first.id });
    const auction = await createAuction(host.user.id, first.id, live.id, { highestBidderId: buyer.user.id, currentPrice: 180 });

    const response = await request(app).post(`/api/auctions/${auction.id}/end`).set(auth(host.token)).expect(200);
    expect(response.body.auction.status).toBe("ENDED");
    const order = await prisma.order.findUnique({ where: { auctionId: auction.id } });
    expect(order?.amount).toBe(180);
    const nextLive = await prisma.liveSession.findUnique({ where: { id: live.id } });
    expect(nextLive?.activeAuctionProductId).toBeNull();
    expect(nextLive?.currentProductId).toBe(second.id);

    const noBid = await createAuction(host.user.id, second.id, live.id, { highestBidderId: null, currentPrice: 100 });
    await request(app).post(`/api/auctions/${noBid.id}/end`).set(auth(host.token)).expect(200);
    await expect(prisma.order.findUnique({ where: { auctionId: noBid.id } })).resolves.toBeNull();
  });

  it("cancels running auctions without order and allows reopening", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);
    const live = await createLive(user.id, [product.id], { status: "LIVE", currentProductId: product.id, activeAuctionProductId: product.id });
    const auction = await createAuction(user.id, product.id, live.id);

    const cancelled = await request(app).post(`/api/auctions/${auction.id}/cancel`).set(auth(token)).expect(200);
    expect(cancelled.body.auction.status).toBe("CANCELLED");
    await expect(prisma.order.findUnique({ where: { auctionId: auction.id } })).resolves.toBeNull();

    await prisma.liveSession.update({ where: { id: live.id }, data: { currentProductId: product.id, activeAuctionProductId: null } });
    await request(app).post("/api/auctions").set(auth(token)).send({ productId: product.id, liveSessionId: live.id }).expect(201);
    await request(app).post(`/api/auctions/${auction.id}/cancel`).set(auth(token)).expect(409);
  });

  it("extends running auctions and clamps seconds", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);
    const auction = await createAuction(user.id, product.id);
    const originalEnd = auction.endTime!.getTime();

    const plusTen = await request(app).post(`/api/auctions/${auction.id}/extend`).set(auth(token)).send({ seconds: 1 }).expect(200);
    expect(new Date(plusTen.body.auction.endTime).getTime()).toBe(originalEnd + 10_000);

    await prisma.auction.update({ where: { id: auction.id }, data: { endTime: new Date(Date.now() - 1000) } });
    const fromNow = await request(app).post(`/api/auctions/${auction.id}/extend`).set(auth(token)).send({ seconds: 500 }).expect(200);
    expect(new Date(fromNow.body.auction.endTime).getTime()).toBeGreaterThan(Date.now() + 290_000);

    await prisma.auction.update({ where: { id: auction.id }, data: { status: "ENDED" } });
    await request(app).post(`/api/auctions/${auction.id}/extend`).set(auth(token)).send({ seconds: 30 }).expect(404);
  });

  it("handles HTTP bids including capPrice, auto-extension and invalid states", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const otherBuyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id, { capPrice: 160, autoExtendSec: 15 });
    const auction = await createAuction(host.user.id, product.id, null, {
      currentPrice: 100,
      minIncrement: 20,
      capPrice: 160,
      autoExtendSec: 15,
      endTime: new Date(Date.now() + 5_000)
    });

    await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(host.token)).send({ amount: 120 }).expect(403);
    await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(buyer.token)).send({ amount: "x" }).expect(400);
    await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(buyer.token)).send({ amount: 119 }).expect(400);

    const firstBid = await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(buyer.token)).send({ amount: 120 }).expect(201);
    expect(firstBid.body.auction.currentPrice).toBe(120);
    expect(new Date(firstBid.body.auction.endTime).getTime()).toBeGreaterThan(auction.endTime!.getTime());

    const capped = await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(otherBuyer.token)).send({ amount: 500 }).expect(201);
    expect(capped.body.auction.status).toBe("ENDED");
    expect(capped.body.auction.currentPrice).toBe(160);

    await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(buyer.token)).send({ amount: 180 }).expect(400);

    const cancelled = await createAuction(host.user.id, product.id, null, { status: "CANCELLED" });
    await request(app).post(`/api/auctions/${cancelled.id}/bids`).set(auth(buyer.token)).send({ amount: 120 }).expect(400);
  });

  it("rejects impossible capPrice cliffs through HTTP bidding", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id, { startPrice: 100, minIncrement: 50, capPrice: 120 });
    const auction = await createAuction(host.user.id, product.id, null, {
      currentPrice: 100,
      minIncrement: 50,
      capPrice: 120
    });

    const response = await request(app).post(`/api/auctions/${auction.id}/bids`).set(auth(buyer.token)).send({ amount: 300 }).expect(400);
    expect(response.body.message).toContain("出价需不低于 150");
    await expect(prisma.bid.count({ where: { auctionId: auction.id } })).resolves.toBe(0);
  });

  it("settles expired auctions on HTTP bid and detail fetch", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const expiredEnd = new Date(Date.now() - 30_000);
    const expiredByBid = await createAuction(host.user.id, product.id, null, {
      endTime: expiredEnd,
      highestBidderId: buyer.user.id,
      currentPrice: 180
    });

    await request(app).post(`/api/auctions/${expiredByBid.id}/bids`).set(auth(buyer.token)).send({ amount: 200 }).expect(400);
    const settledByBid = await prisma.auction.findUnique({ where: { id: expiredByBid.id }, include: { order: true } });
    expect(settledByBid?.status).toBe("ENDED");
    expect(settledByBid?.endTime?.getTime()).toBe(expiredEnd.getTime());
    expect(settledByBid?.order?.amount).toBe(180);

    const expiredByGet = await createAuction(host.user.id, product.id, null, {
      endTime: expiredEnd,
      highestBidderId: null,
      currentPrice: 100
    });
    const response = await request(app).get(`/api/auctions/${expiredByGet.id}`).set(auth(host.token)).expect(200);
    expect(response.body.auction.status).toBe("ENDED");
    await expect(prisma.order.findUnique({ where: { auctionId: expiredByGet.id } })).resolves.toBeNull();
  });
});
