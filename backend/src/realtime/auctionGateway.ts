import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { prisma } from "../config/prisma.js";
import { getRedis } from "../config/redis.js";
import { env } from "../config/env.js";
import { verifyToken } from "../utils/token.js";
import { advanceLiveAfterAuction, AuctionExpiredError, closeAuction } from "../modules/auction/auction.service.js";

type SafeUser = {
  id: string;
  nickname: string;
  email: string;
  role: "CUSTOMER" | "HOST";
};

type SocketData = {
  user: SafeUser;
  auctions: Set<string>;
  viewerAuctions: Set<string>;
  liveSessions: Set<string>;
  viewerLiveSessions: Set<string>;
};

let io: Server | null = null;
const viewerFallback = new Map<string, Set<string>>();
const liveViewerFallback = new Map<string, Set<string>>();

// 生成某场竞拍对应的 Socket.IO 房间名。
function roomName(auctionId: string) {
  return `auction:${auctionId}`;
}

function hostLiveRoom(hostId: string) {
  return `host:${hostId}:lives`;
}

function liveSessionRoom(liveSessionId: string) {
  return `live:${liveSessionId}`;
}

// 生成在线人数集合中的普通用户成员 ID。
function viewerMember(socketId: string) {
  return `CUSTOMER:${socketId}`;
}

// 判断 Redis 在线人数集合中的成员是否是普通用户。
function isCustomerViewer(member: string) {
  return member.startsWith("CUSTOMER:");
}

// 把 Prisma 竞拍结果整理成前端统一使用的 DTO。
function toAuctionDto(auction: any) {
  if (!auction) return null;

  return {
    ...auction,
    bidCount: auction._count?.bids ?? auction.bids?.length ?? auction.bidCount ?? 0,
    bids: auction.bids ?? undefined,
    _count: undefined
  };
}

// 查询所有正在直播的竞拍，用于推送直播大厅。
async function getLiveAuctions() {
  const auctions = await prisma.auction.findMany({
    where: { status: "RUNNING" },
    orderBy: { createdAt: "desc" },
    include: {
      product: true,
      host: { select: { id: true, nickname: true } },
      highestBidder: { select: { id: true, nickname: true } },
      _count: { select: { bids: true } }
    }
  });

  return auctions.map(toAuctionDto);
}

async function getHostLiveSessions(hostId: string) {
  return prisma.liveSession.findMany({
    where: { hostId },
    orderBy: [{ status: "asc" }, { scheduledAt: "desc" }],
    include: {
      products: {
        orderBy: { sortOrder: "asc" },
        include: { product: true }
      },
      auctions: {
        orderBy: { createdAt: "desc" },
        include: {
          product: true,
          highestBidder: { select: { id: true, nickname: true } },
          order: true,
          _count: { select: { bids: true } }
        }
      }
    }
  });
}

async function getLiveSessionDetail(liveSessionId: string) {
  return prisma.liveSession.findUnique({
    where: { id: liveSessionId },
    include: {
      products: {
        orderBy: { sortOrder: "asc" },
        include: { product: true }
      },
      auctions: {
        orderBy: { createdAt: "desc" },
        include: {
          product: true,
          highestBidder: { select: { id: true, nickname: true } },
          order: true,
          _count: { select: { bids: true } }
        }
      }
    }
  });
}

async function getRecentLiveComments(liveSessionId: string) {
  const comments = await prisma.liveComment.findMany({
    where: { liveSessionId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { id: true, nickname: true, role: true } } }
  });

  return comments.reverse().map((comment) => ({
    id: comment.id,
    liveSessionId: comment.liveSessionId,
    userId: comment.userId,
    nickname: comment.user.nickname,
    role: comment.user.role,
    content: comment.content,
    createdAt: comment.createdAt.toISOString()
  }));
}

// 查询单场竞拍详情，用于直播间状态同步。
async function getAuctionDetail(auctionId: string) {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      product: true,
      host: { select: { id: true, nickname: true } },
      highestBidder: { select: { id: true, nickname: true } },
      order: true,
      bids: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { id: true, nickname: true } } }
      },
      _count: { select: { bids: true } }
    }
  });

  return toAuctionDto(auction);
}

// 查询主播当前正在管理的竞拍，用于让主播控制台加入实时房间。
async function getHostAuctions(hostId: string) {
  return prisma.auction.findMany({
    where: { hostId, status: "RUNNING" },
    select: { id: true }
  });
}

// 为单场竞拍加 Redis 锁，避免并发出价导致状态错乱。
async function acquireAuctionLock(auctionId: string) {
  const redis = await getRedis();
  if (!redis) return { redis: null, lockId: null };

  const lockId = randomUUID();
  const result = await redis.set(`lock:auction:${auctionId}`, lockId, "PX", 3000, "NX");

  if (result !== "OK") {
    throw new Error("当前出价人数较多，请稍后重试");
  }

  return { redis, lockId };
}

// 释放当前请求持有的 Redis 出价锁。
async function releaseAuctionLock(auctionId: string, lockId: string | null) {
  if (!lockId) return;

  const redis = await getRedis();
  if (!redis) return;

  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    `lock:auction:${auctionId}`,
    lockId
  );
}

// 记录直播间在线 socket，并返回当前在线人数。
async function addViewer(auctionId: string, socketId: string) {
  const redis = await getRedis();
  const member = viewerMember(socketId);

  if (redis) {
    await redis.sadd(`auction:${auctionId}:viewers`, member);
    await redis.expire(`auction:${auctionId}:viewers`, 60 * 60 * 12);
    return getViewerCount(auctionId);
  }

  const set = viewerFallback.get(auctionId) ?? new Set<string>();
  set.add(member);
  viewerFallback.set(auctionId, set);
  return getViewerCount(auctionId);
}

// 查询直播间当前普通用户在线人数，不改变在线人数集合。
async function getViewerCount(auctionId: string) {
  const redis = await getRedis();

  if (redis) {
    const members = await redis.smembers(`auction:${auctionId}:viewers`);
    return members.filter(isCustomerViewer).length;
  }

  const set = viewerFallback.get(auctionId);
  if (!set) return 0;
  return Array.from(set).filter(isCustomerViewer).length;
}

// 移除直播间在线 socket，并返回当前在线人数。
async function removeViewer(auctionId: string, socketId: string) {
  const redis = await getRedis();
  const member = viewerMember(socketId);

  if (redis) {
    await redis.srem(`auction:${auctionId}:viewers`, member, socketId);
    return getViewerCount(auctionId);
  }

  const set = viewerFallback.get(auctionId);
  if (!set) return 0;
  set.delete(member);
  set.delete(socketId);
  return getViewerCount(auctionId);
}

async function addLiveViewer(liveSessionId: string, socketId: string) {
  const redis = await getRedis();
  const member = viewerMember(socketId);

  if (redis) {
    await redis.sadd(`live:${liveSessionId}:viewers`, member);
    await redis.expire(`live:${liveSessionId}:viewers`, 60 * 60 * 12);
    return getLiveViewerCount(liveSessionId);
  }

  const set = liveViewerFallback.get(liveSessionId) ?? new Set<string>();
  set.add(member);
  liveViewerFallback.set(liveSessionId, set);
  return getLiveViewerCount(liveSessionId);
}

async function getLiveViewerCount(liveSessionId: string) {
  const redis = await getRedis();

  if (redis) {
    const members = await redis.smembers(`live:${liveSessionId}:viewers`);
    return members.filter(isCustomerViewer).length;
  }

  const set = liveViewerFallback.get(liveSessionId);
  if (!set) return 0;
  return Array.from(set).filter(isCustomerViewer).length;
}

async function removeLiveViewer(liveSessionId: string, socketId: string) {
  const redis = await getRedis();
  const member = viewerMember(socketId);

  if (redis) {
    await redis.srem(`live:${liveSessionId}:viewers`, member, socketId);
    return getLiveViewerCount(liveSessionId);
  }

  const set = liveViewerFallback.get(liveSessionId);
  if (!set) return 0;
  set.delete(member);
  set.delete(socketId);
  return getLiveViewerCount(liveSessionId);
}

async function syncLiveViewerCount(liveSessionId: string, viewerCount: number) {
  await prisma.liveSession.update({
    where: { id: liveSessionId },
    data: { onlineCount: viewerCount }
  }).catch(() => undefined);
}

async function broadcastLiveViewerCount(liveSessionId: string, viewerCount: number) {
  await syncLiveViewerCount(liveSessionId, viewerCount);
  io?.to(liveSessionRoom(liveSessionId)).emit("viewer_count_update", { liveSessionId, viewerCount });
  io?.to("lobby").emit("viewer_count_update", { liveSessionId, viewerCount });
  const live = await prisma.liveSession.findUnique({ where: { id: liveSessionId }, select: { hostId: true } });
  if (live) {
    io?.to(hostLiveRoom(live.hostId)).emit("viewer_count_update", { liveSessionId, viewerCount });
  }
}

// 缓存竞拍关键实时状态，供高频读取场景使用。
async function cacheAuctionState(auction: any) {
  if (!auction) return;

  const redis = await getRedis();
  if (!redis) return;

  const key = `auction:${auction.id}`;
  await redis.set(
    `${key}:state`,
    JSON.stringify({
      auctionId: auction.id,
      status: auction.status,
      currentPrice: auction.currentPrice,
      highestBidderId: auction.highestBidderId,
      endTime: auction.endTime,
      minIncrement: auction.minIncrement
    }),
    "EX",
    60 * 60 * 24
  );
}

// 缓存最近出价、排行榜和用户昵称。
async function cacheBid(auctionId: string, userId: string, nickname: string, amount: number, bid: unknown) {
  const redis = await getRedis();
  if (!redis) return;

  const key = `auction:${auctionId}`;
  await redis.zadd(`${key}:ranking`, amount, userId);
  await redis.hset(`${key}:bidder_names`, userId, nickname);
  await redis.lpush(`${key}:recent_bids`, JSON.stringify(bid));
  await redis.ltrim(`${key}:recent_bids`, 0, 19);
  await redis.expire(`${key}:ranking`, 60 * 60 * 24);
  await redis.expire(`${key}:bidder_names`, 60 * 60 * 24);
  await redis.expire(`${key}:recent_bids`, 60 * 60 * 24);
}

// 清理一场竞拍结束后的 Redis 实时缓存。
async function clearAuctionCache(auctionId: string) {
  const redis = await getRedis();
  if (!redis) return;

  await redis.del(
    `auction:${auctionId}:state`,
    `auction:${auctionId}:ranking`,
    `auction:${auctionId}:bidder_names`,
    `auction:${auctionId}:recent_bids`,
    `auction:${auctionId}:viewers`,
    `lock:auction:${auctionId}`
  );
}

// 处理 WebSocket 出价：校验、加锁、写库、更新缓存。
async function placeBid(auctionId: string, user: SafeUser, amount: number) {
  if (user.role !== "CUSTOMER") {
    throw new Error("只有普通用户可以出价");
  }

  if (!Number.isFinite(amount)) {
    throw new Error("出价金额无效");
  }

  const { lockId } = await acquireAuctionLock(auctionId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const auction = await tx.auction.findUnique({
        where: { id: auctionId }
      });

      if (!auction || auction.status !== "RUNNING") {
        throw new Error("竞拍未开始或已结束");
      }

      if (auction.endTime && auction.endTime.getTime() <= Date.now()) {
        throw new AuctionExpiredError({ id: auction.id, liveSessionId: auction.liveSessionId, productId: auction.productId });
      }

      const roundedAmount = Math.round(amount);
      const minAmount = auction.currentPrice + auction.minIncrement;

      if (roundedAmount < minAmount) {
        throw new Error(`出价需不低于 ${minAmount}`);
      }

      const shouldExtend = auction.endTime && auction.endTime.getTime() - Date.now() <= 10000;
      const nextEndTime = shouldExtend ? new Date(auction.endTime!.getTime() + 15000) : auction.endTime;

      const bid = await tx.bid.create({
        data: {
          auctionId: auction.id,
          userId: user.id,
          amount: roundedAmount
        },
        include: { user: { select: { id: true, nickname: true } } }
      });

      const updatedAuction = await tx.auction.update({
        where: { id: auction.id },
        data: {
          currentPrice: roundedAmount,
          highestBidderId: user.id,
          endTime: nextEndTime
        },
        include: {
          product: true,
          host: { select: { id: true, nickname: true } },
          highestBidder: { select: { id: true, nickname: true } },
          bids: {
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { user: { select: { id: true, nickname: true } } }
          },
          _count: { select: { bids: true } }
        }
      });

      return { auction: toAuctionDto(updatedAuction), bid };
    });

    await cacheAuctionState(result.auction);
    await cacheBid(auctionId, user.id, user.nickname, Math.round(amount), result.bid);

    return result.auction;
  } catch (error) {
    if (error instanceof AuctionExpiredError) {
      await closeAuction(error.auction.id);
      if (error.auction.liveSessionId) {
        await advanceLiveAfterAuction(error.auction.liveSessionId, error.auction.productId);
        await emitLiveSessionState(error.auction.liveSessionId);
      }
      await emitAuctionEnded(error.auction.id);
    }
    throw error;
  } finally {
    await releaseAuctionLock(auctionId, lockId);
  }
}

// 获取已初始化的 Socket.IO 服务实例。
export function getRealtimeServer() {
  return io;
}

// 向直播大厅广播当前正在进行的竞拍列表。
export async function emitLiveAuctions() {
  if (!io) return;
  io.to("lobby").emit("live_auctions", { auctions: await getLiveAuctions() });
}

export async function emitLiveSessions(hostId: string) {
  if (!io) return;
  io.to(hostLiveRoom(hostId)).emit("live_sessions", { lives: await getHostLiveSessions(hostId) });
}

export async function emitLiveSessionState(liveSessionId: string) {
  if (!io) return;
  const live = await getLiveSessionDetail(liveSessionId);
  if (!live) return;
  io.to(liveSessionRoom(liveSessionId)).emit("live_session_state", { live });
  io.to(hostLiveRoom(live.hostId)).emit("live_session_state", { live });
}

// 向指定竞拍房间广播最新竞拍状态。
export async function emitAuctionState(auctionId: string, event = "auction_state") {
  if (!io) return;

  const auction = await getAuctionDetail(auctionId);
  if (!auction) return;

  io.to(roomName(auctionId)).emit(event, { auction });
}

// 广播竞拍结束事件，并同步清理实时缓存。
export async function emitAuctionEnded(auctionId: string) {
  await emitAuctionState(auctionId, "auction_ended");
  await clearAuctionCache(auctionId);
  await emitLiveAuctions();
}

// 初始化 Socket.IO 实时网关并注册所有实时事件。
export async function initializeRealtime(server: HttpServer) {
  io = new Server(server, {
    cors: {
      origin: [env.merchantOrigin, env.mobileOrigin],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    const payload = typeof token === "string" ? verifyToken(token) : null;

    if (!payload) {
      next(new Error("登录已失效"));
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, nickname: true, email: true, role: true }
    });

    if (!user) {
      next(new Error("用户不存在"));
      return;
    }

    socket.data.user = user;
    socket.data.auctions = new Set<string>();
    socket.data.viewerAuctions = new Set<string>();
    socket.data.liveSessions = new Set<string>();
    socket.data.viewerLiveSessions = new Set<string>();
    next();
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;

    socket.on("join_lobby", async (_payload, callback) => {
      try {
        socket.join("lobby");
        const auctions = await getLiveAuctions();
        socket.emit("live_auctions", { auctions });
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error instanceof Error ? error.message : "加入大厅失败" });
      }
    });

    socket.on("leave_lobby", () => {
      socket.leave("lobby");
    });

    socket.on("join_host_dashboard", async (_payload, callback) => {
      try {
        if (data.user.role !== "HOST") throw new Error("只有主播可以进入控制台实时频道");

        socket.join(hostLiveRoom(data.user.id));
        socket.emit("live_sessions", { lives: await getHostLiveSessions(data.user.id) });

        const auctions = await getHostAuctions(data.user.id);

        for (const auction of auctions) {
          socket.join(roomName(auction.id));
          data.auctions.add(auction.id);

          const viewerCount = await getViewerCount(auction.id);
          socket.emit("viewer_count_update", { auctionId: auction.id, viewerCount });
        }

        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error instanceof Error ? error.message : "加入主播实时频道失败" });
      }
    });

    socket.on("join_live_session", async (payload: { liveSessionId?: string }, callback) => {
      try {
        const liveSessionId = String(payload?.liveSessionId ?? "");
        if (!liveSessionId) throw new Error("缺少直播场次 ID");

        const live = await getLiveSessionDetail(liveSessionId);
        if (!live) throw new Error("直播场次不存在");
        if (data.user.role === "HOST" && live.hostId !== data.user.id) throw new Error("无权进入该直播控制台");

        socket.join(liveSessionRoom(liveSessionId));
        data.liveSessions.add(liveSessionId);
        const shouldCountViewer = data.user.role === "CUSTOMER" && !data.viewerLiveSessions.has(liveSessionId);
        const viewerCount = shouldCountViewer ? await addLiveViewer(liveSessionId, socket.id) : await getLiveViewerCount(liveSessionId);
        if (shouldCountViewer) data.viewerLiveSessions.add(liveSessionId);
        socket.emit("live_session_state", { live });
        socket.emit("chat_history", { liveSessionId, messages: await getRecentLiveComments(liveSessionId) });
        await broadcastLiveViewerCount(liveSessionId, viewerCount);
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error instanceof Error ? error.message : "进入直播场次失败" });
      }
    });

    socket.on("leave_live_session", (payload: { liveSessionId?: string }) => {
      const liveSessionId = String(payload?.liveSessionId ?? "");
      if (!liveSessionId) return;
      socket.leave(liveSessionRoom(liveSessionId));
      data.liveSessions.delete(liveSessionId);
      if (!data.viewerLiveSessions.has(liveSessionId)) return;
      removeLiveViewer(liveSessionId, socket.id).then((viewerCount) => {
        data.viewerLiveSessions.delete(liveSessionId);
        return broadcastLiveViewerCount(liveSessionId, viewerCount);
      }).catch(() => undefined);
    });

    socket.on("join_auction", async (payload: { auctionId?: string }, callback) => {
      try {
        const auctionId = String(payload?.auctionId ?? "");
        if (!auctionId) throw new Error("缺少竞拍 ID");

        socket.join(roomName(auctionId));
        data.auctions.add(auctionId);

        const viewerCount = data.user.role === "CUSTOMER" ? await addViewer(auctionId, socket.id) : await getViewerCount(auctionId);
        if (data.user.role === "CUSTOMER") data.viewerAuctions.add(auctionId);

        const auction = await getAuctionDetail(auctionId);

        socket.emit("auction_state", { auction });
        if (data.user.role === "CUSTOMER") {
          io?.to(roomName(auctionId)).emit("viewer_count_update", { auctionId, viewerCount });
        } else {
          socket.emit("viewer_count_update", { auctionId, viewerCount });
        }
        callback?.({ ok: true });
      } catch (error) {
        callback?.({ ok: false, message: error instanceof Error ? error.message : "进入直播间失败" });
      }
    });

    socket.on("leave_auction", async (payload: { auctionId?: string }) => {
      const auctionId = String(payload?.auctionId ?? "");
      if (!auctionId) return;

      socket.leave(roomName(auctionId));
      data.auctions.delete(auctionId);
      if (!data.viewerAuctions.has(auctionId)) return;

      const viewerCount = await removeViewer(auctionId, socket.id);
      data.viewerAuctions.delete(auctionId);
      io?.to(roomName(auctionId)).emit("viewer_count_update", { auctionId, viewerCount });
    });

    socket.on("place_bid", async (payload: { auctionId?: string; amount?: number }, callback) => {
      try {
        const auctionId = String(payload?.auctionId ?? "");
        const amount = Number(payload?.amount);
        const auction = await placeBid(auctionId, data.user, amount);

        io?.to(roomName(auctionId)).emit("bid_update", { auction });
        await emitLiveAuctions();
        callback?.({ ok: true, auction });
      } catch (error) {
        callback?.({ ok: false, message: error instanceof Error ? error.message : "出价失败" });
      }
    });

    socket.on("send_chat", async (payload: { auctionId?: string; liveSessionId?: string; content?: string }, callback) => {
      try {
        const auctionId = String(payload?.auctionId ?? "");
        const payloadLiveSessionId = String(payload?.liveSessionId ?? "");
        const content = String(payload?.content ?? "").trim();
        let liveSessionId = payloadLiveSessionId;

        if (!liveSessionId && auctionId) {
          const auction = await prisma.auction.findUnique({ where: { id: auctionId }, select: { liveSessionId: true } });
          liveSessionId = auction?.liveSessionId ?? "";
        }
        if (!liveSessionId) throw new Error("缺少直播间 ID");
        if (!content) throw new Error("请输入弹幕内容");
        if (content.length > 80) throw new Error("弹幕最多 80 个字");

        const comment = await prisma.liveComment.create({
          data: { liveSessionId, userId: data.user.id, content },
          include: { user: { select: { id: true, nickname: true, role: true } } }
        });
        const message = {
          id: comment.id,
          liveSessionId,
          auctionId: auctionId || undefined,
          userId: comment.userId,
          nickname: comment.user.nickname,
          role: comment.user.role,
          content: comment.content,
          createdAt: comment.createdAt.toISOString()
        };

        io?.to(liveSessionRoom(liveSessionId)).emit("chat_message", { message });
        callback?.({ ok: true, message });
      } catch (error) {
        callback?.({ ok: false, message: error instanceof Error ? error.message : "弹幕发送失败" });
      }
    });

    socket.on("disconnect", async () => {
      for (const liveSessionId of data.viewerLiveSessions) {
        const viewerCount = await removeLiveViewer(liveSessionId, socket.id);
        await broadcastLiveViewerCount(liveSessionId, viewerCount);
      }
      for (const auctionId of data.viewerAuctions) {
        const viewerCount = await removeViewer(auctionId, socket.id);
        io?.to(roomName(auctionId)).emit("viewer_count_update", { auctionId, viewerCount });
      }
    });
  });

  console.log("Socket.IO realtime gateway ready");
}

export { cacheAuctionState };
