import request from "supertest";
import { afterAll, beforeEach, expect, it } from "vitest";
import { app, auth, createAuction, createLive, createProduct, createUser, describeDb, prisma, resetDb } from "../helpers/integration.js";

async function createPendingOrder() {
  const host = await createUser("HOST");
  const buyer = await createUser("CUSTOMER");
  const product = await createProduct(host.user.id);
  const auction = await createAuction(host.user.id, product.id, null, { status: "ENDED", highestBidderId: buyer.user.id, currentPrice: 180 });
  const order = await prisma.order.create({ data: { auctionId: auction.id, productId: product.id, buyerId: buyer.user.id, amount: 180 } });
  return { host, buyer, product, auction, order };
}

describeDb("order API", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("requires address for payment and binds default address", async () => {
    const { buyer, order } = await createPendingOrder();
    await request(app).post(`/api/orders/${order.id}/pay`).set(auth(buyer.token)).expect(409);

    const address = await prisma.address.create({ data: { userId: buyer.user.id, name: "张三", phone: "13800000000", detail: "测试地址", isDefault: true } });
    const paid = await request(app).post(`/api/orders/${order.id}/pay`).set(auth(buyer.token)).expect(200);
    expect(paid.body.order.status).toBe("PAID");
    expect(paid.body.order.addressId).toBe(address.id);
  });

  it("keeps payment idempotent and updates address for already paid orders", async () => {
    const { buyer, order } = await createPendingOrder();
    const firstAddress = await prisma.address.create({ data: { userId: buyer.user.id, name: "张三", phone: "13800000000", detail: "旧地址", isDefault: true } });
    await request(app).post(`/api/orders/${order.id}/pay`).set(auth(buyer.token)).expect(200);
    const secondAddress = await prisma.address.create({ data: { userId: buyer.user.id, name: "李四", phone: "13900000000", detail: "新地址", isDefault: true } });
    await prisma.order.update({ where: { id: order.id }, data: { addressId: firstAddress.id } });

    const paidAgain = await request(app).post(`/api/orders/${order.id}/pay`).set(auth(buyer.token)).expect(200);
    expect(paidAgain.body.order.addressId).toBe(firstAddress.id);

    const updatedAddress = await request(app).post(`/api/mobile/orders/${order.id}/address`).set(auth(buyer.token)).send({ addressId: secondAddress.id }).expect(200);
    expect(updatedAddress.body.order.address.id).toBe(secondAddress.id);
  });

  it("supports customer cancel and host close only while pending payment", async () => {
    const pending = await createPendingOrder();
    const cancelled = await request(app).post(`/api/orders/${pending.order.id}/cancel`).set(auth(pending.buyer.token)).expect(200);
    expect(cancelled.body.order.status).toBe("CANCELLED");
    await request(app).post(`/api/orders/${pending.order.id}/pay`).set(auth(pending.buyer.token)).expect(409);

    const closable = await createPendingOrder();
    const closed = await request(app).post(`/api/orders/${closable.order.id}/close`).set(auth(closable.host.token)).expect(200);
    expect(closed.body.order.status).toBe("CANCELLED");

    const paid = await createPendingOrder();
    await prisma.address.create({ data: { userId: paid.buyer.user.id, name: "张三", phone: "13800000000", detail: "测试地址", isDefault: true } });
    await request(app).post(`/api/orders/${paid.order.id}/pay`).set(auth(paid.buyer.token)).expect(200);
    await request(app).post(`/api/orders/${paid.order.id}/cancel`).set(auth(paid.buyer.token)).expect(409);
    await request(app).post(`/api/orders/${paid.order.id}/close`).set(auth(paid.host.token)).expect(409);
  });

  it("ships and completes orders according to state machine", async () => {
    const fixture = await createPendingOrder();
    await request(app).post(`/api/orders/${fixture.order.id}/ship`).set(auth(fixture.host.token)).send({ company: "顺丰", trackingNo: "SF1" }).expect(409);
    await prisma.address.create({ data: { userId: fixture.buyer.user.id, name: "张三", phone: "13800000000", detail: "测试地址", isDefault: true } });
    await request(app).post(`/api/orders/${fixture.order.id}/pay`).set(auth(fixture.buyer.token)).expect(200);
    await request(app).post(`/api/orders/${fixture.order.id}/ship`).set(auth(fixture.host.token)).send({ company: "顺丰" }).expect(400);
    const shipped = await request(app).post(`/api/orders/${fixture.order.id}/ship`).set(auth(fixture.host.token)).send({ company: "顺丰", trackingNo: "SF1" }).expect(200);
    expect(shipped.body.order.status).toBe("SHIPPED");
    const completed = await request(app).post(`/api/mobile/orders/${fixture.order.id}/complete`).set(auth(fixture.buyer.token)).expect(200);
    expect(completed.body.order.status).toBe("已完成");

    const pending = await createPendingOrder();
    await request(app).post(`/api/orders/${pending.order.id}/complete`).set(auth(pending.host.token)).expect(409);
  });

  it("rejects address changes after shipping", async () => {
    const fixture = await createPendingOrder();
    const address = await prisma.address.create({ data: { userId: fixture.buyer.user.id, name: "张三", phone: "13800000000", detail: "测试地址", isDefault: true } });
    await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "SHIPPED", addressId: address.id } });
    await request(app).post(`/api/mobile/orders/${fixture.order.id}/address`).set(auth(fixture.buyer.token)).send({ addressId: address.id }).expect(409);
  });
});

describeDb("mobile API", () => {
  beforeEach(resetDb);
  afterAll(() => prisma.$disconnect());

  it("filters live rooms without current product and rejects HOST callers", async () => {
    const host = await createUser("HOST");
    const customer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    await createLive(host.user.id, [], { status: "LIVE", currentProductId: null });
    await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id });

    await request(app).get("/api/mobile/live-rooms").set(auth(host.token)).expect(403);
    const response = await request(app).get("/api/mobile/live-rooms").set(auth(customer.token)).expect(200);
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0].currentProduct.id).toBe(product.id);
  });

  it("deduplicates ranking by user highest bid", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const otherBuyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const live = await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id, activeAuctionProductId: product.id });
    const auction = await createAuction(host.user.id, product.id, live.id, { currentPrice: 180, highestBidderId: buyer.user.id });
    await prisma.bid.createMany({
      data: [
        { auctionId: auction.id, userId: buyer.user.id, amount: 140 },
        { auctionId: auction.id, userId: buyer.user.id, amount: 180 },
        { auctionId: auction.id, userId: otherBuyer.user.id, amount: 160 }
      ]
    });

    const response = await request(app).get(`/api/mobile/live-rooms/${live.id}`).set(auth(buyer.token)).expect(200);
    expect(response.body.ranking).toHaveLength(2);
    expect(response.body.ranking[0].price).toBe(180);
    expect(response.body.ranking.filter((row: { user: string }) => row.user === buyer.user.nickname)).toHaveLength(1);
  });

  it("shows cancelled bid history as 已取消 and updates default address", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id, null, { status: "CANCELLED", highestBidderId: null });
    await prisma.bid.create({ data: { auctionId: auction.id, userId: buyer.user.id, amount: 120 } });

    const history = await request(app).get("/api/mobile/bid-history").set(auth(buyer.token)).expect(200);
    expect(history.body.items[0].status).toBe("已取消");

    const first = await prisma.address.create({ data: { userId: buyer.user.id, name: "一", phone: "1", detail: "地址1", isDefault: true } });
    const second = await prisma.address.create({ data: { userId: buyer.user.id, name: "二", phone: "2", detail: "地址2", isDefault: false } });
    const updated = await request(app).post(`/api/mobile/addresses/${second.id}/default`).set(auth(buyer.token)).expect(200);
    expect(updated.body.addresses.find((item: { id: string }) => item.id === first.id).isDefault).toBe(false);
    expect(updated.body.addresses.find((item: { id: string }) => item.id === second.id).isDefault).toBe(true);
  });
});
