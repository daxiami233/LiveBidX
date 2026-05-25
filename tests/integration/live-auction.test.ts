import request from "supertest";
import { afterAll, beforeEach, expect, it } from "vitest";
import { app, auth, createAuction, createLive, createProduct, createUser, describeDb, prisma, resetDb } from "../helpers/integration.js";

describeDb("live lifecycle and queue API", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("creates, starts, blocks duplicate live sessions, ends and blocks restart", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);
    const created = await request(app).post("/api/lives").set(auth(token)).send({
      title: "测试直播",
      scheduledAt: new Date(Date.now() + 60_000).toISOString(),
      productIds: [product.id]
    }).expect(201);

    expect(created.body.live.status).toBe("SCHEDULED");
    const started = await request(app).post(`/api/lives/${created.body.live.id}/start`).set(auth(token)).expect(200);
    expect(started.body.live.status).toBe("LIVE");

    const secondLive = await createLive(user.id);
    await request(app).post(`/api/lives/${secondLive.id}/start`).set(auth(token)).expect(409);
    await request(app).patch(`/api/lives/${created.body.live.id}`).set(auth(token)).send({ title: "改名" }).expect(409);
    const ended = await request(app).post(`/api/lives/${created.body.live.id}/end`).set(auth(token)).expect(200);
    expect(ended.body.live.status).toBe("ENDED");
    await request(app).post(`/api/lives/${created.body.live.id}/start`).set(auth(token)).expect(409);
  });

  it("ends running auctions when ending a live session", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const live = await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id, activeAuctionProductId: product.id });
    const auction = await createAuction(host.user.id, product.id, live.id, { highestBidderId: buyer.user.id, currentPrice: 160 });

    await request(app).post(`/api/lives/${live.id}/end`).set(auth(host.token)).expect(200);

    const endedAuction = await prisma.auction.findUnique({ where: { id: auction.id }, include: { order: true } });
    expect(endedAuction?.status).toBe("ENDED");
    expect(endedAuction?.order?.amount).toBe(160);
  });

  it("rejects deleting live sessions with auction history or active live state", async () => {
    const { user, token } = await createUser("HOST");
    const product = await createProduct(user.id);
    const live = await createLive(user.id, [product.id], { status: "LIVE" });
    await request(app).delete(`/api/lives/${live.id}`).set(auth(token)).expect(409);

    await prisma.liveSession.update({ where: { id: live.id }, data: { status: "SCHEDULED" } });
    await createAuction(user.id, product.id, live.id, { status: "ENDED" });
    await request(app).delete(`/api/lives/${live.id}`).set(auth(token)).expect(409);
  });

  it("manages queue and auto switches current product on delete", async () => {
    const { user, token } = await createUser("HOST");
    const first = await createProduct(user.id);
    const second = await createProduct(user.id);
    const live = await createLive(user.id, [first.id, second.id], { status: "LIVE", currentProductId: first.id });

    await request(app).post(`/api/lives/${live.id}/products`).set(auth(token)).send({ productId: second.id }).expect(409);

    const removed = await request(app).delete(`/api/lives/${live.id}/products/${first.id}`).set(auth(token)).expect(200);
    expect(removed.body.live.currentProductId).toBe(second.id);
  });

  it("rejects archived products, foreign products, ended live changes and active auction product deletion", async () => {
    const host = await createUser("HOST");
    const otherHost = await createUser("HOST");
    const archived = await createProduct(host.user.id, { status: "ARCHIVED" });
    const foreign = await createProduct(otherHost.user.id);
    const active = await createProduct(host.user.id);
    const live = await createLive(host.user.id, [active.id], { status: "LIVE", currentProductId: active.id, activeAuctionProductId: active.id });
    await createAuction(host.user.id, active.id, live.id);

    await request(app).post(`/api/lives/${live.id}/products`).set(auth(host.token)).send({ productId: archived.id }).expect(404);
    await request(app).post(`/api/lives/${live.id}/products`).set(auth(host.token)).send({ productId: foreign.id }).expect(404);
    await request(app).delete(`/api/lives/${live.id}/products/${active.id}`).set(auth(host.token)).expect(409);

    await prisma.liveSession.update({ where: { id: live.id }, data: { status: "ENDED", activeAuctionProductId: null } });
    await request(app).post(`/api/lives/${live.id}/products`).set(auth(host.token)).send({ productId: archived.id }).expect(409);
  });

  it("switches current product while allowing cancelled products and rejecting ended products", async () => {
    const { user, token } = await createUser("HOST");
    const endedProduct = await createProduct(user.id);
    const cancelledProduct = await createProduct(user.id);
    const live = await createLive(user.id, [endedProduct.id, cancelledProduct.id], { status: "LIVE", currentProductId: cancelledProduct.id });
    await createAuction(user.id, endedProduct.id, live.id, { status: "ENDED" });
    await createAuction(user.id, cancelledProduct.id, live.id, { status: "CANCELLED" });

    await request(app).post(`/api/lives/${live.id}/current-product`).set(auth(token)).send({ productId: endedProduct.id }).expect(409);
    await request(app).post(`/api/lives/${live.id}/current-product`).set(auth(token)).send({ productId: cancelledProduct.id }).expect(200);
    await request(app).post(`/api/lives/${live.id}/current-product`).set(auth(token)).send({ productId: "missing" }).expect(400);

    await prisma.liveSession.update({ where: { id: live.id }, data: { activeAuctionProductId: cancelledProduct.id } });
    await request(app).post(`/api/lives/${live.id}/current-product`).set(auth(token)).send({ productId: endedProduct.id }).expect(409);
    await request(app).post(`/api/lives/${live.id}/current-product`).set(auth(token)).send({ productId: cancelledProduct.id }).expect(200);
  });
});
