import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  createAuction,
  createLive,
  createProduct,
  createUser,
  describeDb,
  getRealtimeServer,
  initializeRealtime,
  prisma,
  resetDb,
  resetRateLimits,
  server
} from "../helpers/integration.js";

let baseUrl = "";

function listen(serverToListen: typeof server) {
  return new Promise<void>((resolve) => {
    serverToListen.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer() {
  return new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

function closeRealtime() {
  return new Promise<void>((resolve) => {
    const realtime = getRealtimeServer();
    if (!realtime) {
      resolve();
      return;
    }
    realtime.close(() => resolve());
  });
}

function connect(token: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: { token },
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    });
    const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 3000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitAck<T = any>(socket: Socket, event: string, payload: unknown) {
  return new Promise<T>((resolve) => {
    socket.emit(event, payload, (response: T) => resolve(response));
  });
}

function waitFor<T = any>(socket: Socket, event: string, predicate: (payload: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, 3000);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

async function disconnect(socket: Socket) {
  if (!socket.connected) return;
  await new Promise<void>((resolve) => {
    socket.once("disconnect", () => resolve());
    socket.disconnect();
  });
}

describeDb("websocket auction gateway", () => {
  beforeAll(async () => {
    await initializeRealtime(server);
    await listen(server);
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    resetRateLimits();
    await resetDb();
  });

  afterAll(async () => {
    await closeRealtime();
    await closeServer();
    await prisma.$disconnect();
  });

  it("broadcasts bid_update for successful place_bid events", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id);
    const buyerSocket = await connect(buyer.token);

    await emitAck(buyerSocket, "join_auction", { auctionId: auction.id });
    const bidUpdate = waitFor<{ auction: { id: string; currentPrice: number; highestBidderId: string } }>(
      buyerSocket,
      "bid_update",
      (payload) => payload.auction.id === auction.id
    );
    const ack = await emitAck<{ ok: boolean; auction: { currentPrice: number } }>(buyerSocket, "place_bid", { auctionId: auction.id, amount: 120 });
    const update = await bidUpdate;

    expect(ack.ok).toBe(true);
    expect(ack.auction.currentPrice).toBe(120);
    expect(update.auction.currentPrice).toBe(120);
    expect(update.auction.highestBidderId).toBe(buyer.user.id);
    await disconnect(buyerSocket);
  });

  it("auto-closes and broadcasts auction_ended when a websocket bid reaches capPrice", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id, { capPrice: 140 });
    const live = await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id, activeAuctionProductId: product.id });
    const auction = await createAuction(host.user.id, product.id, live.id, { capPrice: 140, currentPrice: 100, minIncrement: 20 });
    const buyerSocket = await connect(buyer.token);

    await emitAck(buyerSocket, "join_auction", { auctionId: auction.id });
    const ended = waitFor<{ auction: { id: string; status: string; currentPrice: number } }>(
      buyerSocket,
      "auction_ended",
      (payload) => payload.auction.id === auction.id
    );
    const ack = await emitAck<{ ok: boolean; auction: { status: string; currentPrice: number } }>(buyerSocket, "place_bid", { auctionId: auction.id, amount: 999 });
    const event = await ended;

    expect(ack.ok).toBe(true);
    expect(ack.auction.status).toBe("ENDED");
    expect(event.auction.status).toBe("ENDED");
    expect(event.auction.currentPrice).toBe(140);
    await expect(prisma.order.count({ where: { auctionId: auction.id } })).resolves.toBe(1);
    const updatedLive = await prisma.liveSession.findUnique({ where: { id: live.id } });
    expect(updatedLive?.activeAuctionProductId).toBeNull();
    await disconnect(buyerSocket);
  });

  it("settles expired websocket bids and returns an error callback", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const auction = await createAuction(host.user.id, product.id, null, {
      endTime: new Date(Date.now() - 10_000),
      highestBidderId: buyer.user.id,
      currentPrice: 160
    });
    const buyerSocket = await connect(buyer.token);

    await emitAck(buyerSocket, "join_auction", { auctionId: auction.id });
    const ended = waitFor<{ auction: { id: string; status: string } }>(buyerSocket, "auction_ended", (payload) => payload.auction.id === auction.id);
    const ack = await emitAck<{ ok: boolean; message: string }>(buyerSocket, "place_bid", { auctionId: auction.id, amount: 180 });
    const event = await ended;

    expect(ack.ok).toBe(false);
    expect(ack.message).toContain("竞拍已结束");
    expect(event.auction.status).toBe("ENDED");
    await expect(prisma.order.count({ where: { auctionId: auction.id } })).resolves.toBe(1);
    await disconnect(buyerSocket);
  });

  it("counts customers but not hosts in live and auction viewer rooms", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const live = await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id });
    const auction = await createAuction(host.user.id, product.id, live.id);
    const hostSocket = await connect(host.token);
    const buyerSocket = await connect(buyer.token);

    await emitAck(hostSocket, "join_live_session", { liveSessionId: live.id });
    const liveViewerEvent = waitFor<{ liveSessionId: string; viewerCount: number }>(
      hostSocket,
      "viewer_count_update",
      (payload) => payload.liveSessionId === live.id && payload.viewerCount === 1
    );
    await emitAck(buyerSocket, "join_live_session", { liveSessionId: live.id });
    const liveViewer = await liveViewerEvent;
    expect(liveViewer.viewerCount).toBe(1);

    await emitAck(hostSocket, "join_auction", { auctionId: auction.id });
    const auctionViewerEvent = waitFor<{ auctionId: string; viewerCount: number }>(
      hostSocket,
      "viewer_count_update",
      (payload) => payload.auctionId === auction.id && payload.viewerCount === 1
    );
    await emitAck(buyerSocket, "join_auction", { auctionId: auction.id });
    const auctionViewer = await auctionViewerEvent;
    expect(auctionViewer.viewerCount).toBe(1);

    await disconnect(buyerSocket);
    await disconnect(hostSocket);
  });

  it("broadcasts live chat and rate limits chat bursts", async () => {
    const host = await createUser("HOST");
    const buyer = await createUser("CUSTOMER");
    const product = await createProduct(host.user.id);
    const live = await createLive(host.user.id, [product.id], { status: "LIVE", currentProductId: product.id });
    const buyerSocket = await connect(buyer.token);

    await emitAck(buyerSocket, "join_live_session", { liveSessionId: live.id });
    const messageEvent = waitFor<{ message: { liveSessionId: string; content: string } }>(buyerSocket, "chat_message");
    const first = await emitAck<{ ok: boolean; message: { content: string } }>(buyerSocket, "send_chat", { liveSessionId: live.id, content: "出价看看" });
    const broadcast = await messageEvent;
    expect(first.ok).toBe(true);
    expect(first.message.content).toBe("出价看看");
    expect(broadcast.message.liveSessionId).toBe(live.id);

    for (let index = 0; index < 5; index += 1) {
      await emitAck(buyerSocket, "send_chat", { liveSessionId: live.id, content: `继续 ${index}` });
    }
    const limited = await emitAck<{ ok: boolean; message: string }>(buyerSocket, "send_chat", { liveSessionId: live.id, content: "太快了" });
    expect(limited.ok).toBe(false);
    expect(limited.message).toContain("发送太频繁");
    await disconnect(buyerSocket);
  });
});
