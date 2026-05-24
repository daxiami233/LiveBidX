import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { emitLiveSessions, emitLiveSessionState } from "../../realtime/auctionGateway.js";
import { asyncHandler, parseTags, toDate } from "../../utils/http.js";
import { closeAuction } from "../auction/auction.service.js";

const router = Router();

const liveInclude = {
  products: {
    orderBy: { sortOrder: "asc" as const },
    include: { product: true }
  },
  auctions: {
    orderBy: { createdAt: "desc" as const },
    include: {
      product: true,
      highestBidder: { select: { id: true, nickname: true } },
      order: true,
      _count: { select: { bids: true } }
    }
  }
};

function roomId() {
  return String(10000000 + Math.floor(Math.random() * 89999999));
}

function productIdsOf(live: { products?: Array<{ productId: string }> }) {
  return live.products?.map((item) => item.productId) ?? [];
}

async function loadLive(id: string, hostId: string) {
  return prisma.liveSession.findFirst({
    where: { id, hostId },
    include: liveInclude
  });
}

router.get(
  "/",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (_req, res) => {
    const lives = await prisma.liveSession.findMany({
      where: { hostId: res.locals.user.id },
      orderBy: [{ status: "asc" }, { scheduledAt: "desc" }],
      include: liveInclude
    });

    res.json({ lives });
  })
);

router.get(
  "/active",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (_req, res) => {
    const live = await prisma.liveSession.findFirst({
      where: { hostId: res.locals.user.id, status: "LIVE" },
      include: liveInclude
    });

    res.json({ live });
  })
);

router.get(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live) {
      res.status(404).json({ message: "直播场次不存在或无权限" });
      return;
    }

    res.json({ live });
  })
);

router.post(
  "/",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const title = String(req.body.title ?? "").trim();
    const scheduledAt = toDate(req.body.scheduledAt);
    const tags = parseTags(req.body.tags);
    const productIds: string[] = Array.isArray(req.body.productIds) ? req.body.productIds.map((id: unknown) => String(id)).filter(Boolean) : [];

    if (!title || !scheduledAt) {
      res.status(400).json({ message: "请填写直播标题和计划开播时间" });
      return;
    }

    const validProducts = productIds.length ? await prisma.product.findMany({
      where: { id: { in: productIds }, hostId: res.locals.user.id, status: { in: ["DRAFT", "ACTIVE"] } },
      select: { id: true }
    }) : [];
    const validProductIds = productIds.filter((id: string, index: number, source: string[]) => source.indexOf(id) === index && validProducts.some((product) => product.id === id));

    const live = await prisma.liveSession.create({
      data: {
        hostId: res.locals.user.id,
        title,
        roomId: String(req.body.roomId ?? "").trim() || roomId(),
        scheduledAt,
        tags,
        coverImage: String(req.body.coverImage ?? "").trim() || null,
        currentProductId: validProductIds[0] ?? null,
        products: {
          create: validProductIds.map((productId: string, index: number) => ({ productId, sortOrder: index }))
        }
      },
      include: liveInclude
    });

    if (validProductIds.length) {
      await prisma.product.updateMany({
        where: { id: { in: validProductIds }, hostId: res.locals.user.id, status: "DRAFT" },
        data: { status: "ACTIVE" }
      });
    }

    await emitLiveSessions(res.locals.user.id);
    res.status(201).json({ live });
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live) {
      res.status(404).json({ message: "直播场次不存在或无权限" });
      return;
    }
    if (live.status === "LIVE") {
      res.status(409).json({ message: "直播中不能修改基础信息" });
      return;
    }

    let nextScheduledAt: Date | undefined;
    if (req.body.scheduledAt !== undefined) {
      const parsedScheduledAt = toDate(req.body.scheduledAt);
      if (!parsedScheduledAt) {
        res.status(400).json({ message: "计划开播时间无效" });
        return;
      }
      nextScheduledAt = parsedScheduledAt;
    }

    const updated = await prisma.liveSession.update({
      where: { id: live.id },
      data: {
        title: req.body.title === undefined ? undefined : String(req.body.title).trim(),
        scheduledAt: nextScheduledAt,
        tags: req.body.tags === undefined ? undefined : parseTags(req.body.tags),
        coverImage: req.body.coverImage === undefined ? undefined : String(req.body.coverImage).trim() || null
      },
      include: liveInclude
    });

    await emitLiveSessions(res.locals.user.id);
    res.json({ live: updated });
  })
);

router.delete(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live) {
      res.status(404).json({ message: "直播场次不存在或无权限" });
      return;
    }
    if (live.status === "LIVE") {
      res.status(409).json({ message: "直播中不能删除，请先结束直播" });
      return;
    }

    await prisma.$transaction([
      prisma.liveProduct.deleteMany({ where: { liveSessionId: live.id } }),
      prisma.liveSession.delete({ where: { id: live.id } })
    ]);

    await emitLiveSessions(res.locals.user.id);
    res.json({ message: "直播场次已删除" });
  })
);

router.post(
  "/:id/products",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const productId = String(req.body.productId ?? "");
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live) {
      res.status(404).json({ message: "直播场次不存在或无权限" });
      return;
    }
    if (live.status !== "SCHEDULED") {
      res.status(409).json({ message: "只有待开播直播可以添加拍品" });
      return;
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, hostId: res.locals.user.id, status: { in: ["DRAFT", "ACTIVE"] } }
    });
    if (!product) {
      res.status(404).json({ message: "商品不存在、已下架或无权限" });
      return;
    }

    const maxSort = live.products.reduce((max, item) => Math.max(max, item.sortOrder), -1);
    const updated = await prisma.liveSession.update({
      where: { id: live.id },
      data: {
        coverImage: live.coverImage ?? product.imageUrl,
        currentProductId: live.currentProductId ?? product.id,
        products: {
          create: {
            productId: product.id,
            sortOrder: maxSort + 1
          }
        }
      },
      include: liveInclude
    });

    if (product.status === "DRAFT") {
      await prisma.product.update({ where: { id: product.id }, data: { status: "ACTIVE" } });
    }

    await emitLiveSessions(res.locals.user.id);
    res.status(201).json({ live: updated });
  })
);

router.delete(
  "/:id/products/:productId",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live) {
      res.status(404).json({ message: "直播场次不存在或无权限" });
      return;
    }
    if (live.status !== "SCHEDULED") {
      res.status(409).json({ message: "只有待开播直播可以移除拍品" });
      return;
    }

    await prisma.liveProduct.deleteMany({ where: { liveSessionId: live.id, productId: req.params.productId } });
    const nextProductIds = productIdsOf(live).filter((id) => id !== req.params.productId);
    const updated = await prisma.liveSession.update({
      where: { id: live.id },
      data: {
        currentProductId: live.currentProductId === req.params.productId ? nextProductIds[0] ?? null : live.currentProductId
      },
      include: liveInclude
    });

    await emitLiveSessions(res.locals.user.id);
    res.json({ live: updated });
  })
);

router.post(
  "/:id/start",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live) {
      res.status(404).json({ message: "直播场次不存在或无权限" });
      return;
    }
    if (live.status === "LIVE") {
      res.json({ live });
      return;
    }

    const running = await prisma.liveSession.findFirst({
      where: { hostId: res.locals.user.id, status: "LIVE", id: { not: live.id } }
    });
    if (running) {
      res.status(409).json({ message: "当前已有直播进行中，请先结束当前直播" });
      return;
    }

    const firstProductId = live.currentProductId ?? productIdsOf(live)[0] ?? null;
    const updated = await prisma.liveSession.update({
      where: { id: live.id },
      data: {
        status: "LIVE",
        startedAt: new Date(),
        onlineCount: 0,
        streamStatus: "正常",
        currentProductId: firstProductId
      },
      include: liveInclude
    });

    await emitLiveSessions(res.locals.user.id);
    await emitLiveSessionState(updated.id);
    res.json({ live: updated });
  })
);

router.post(
  "/:id/end",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live || live.status !== "LIVE") {
      res.status(404).json({ message: "当前直播不存在或未开始" });
      return;
    }

    const runningAuctions = await prisma.auction.findMany({
      where: { liveSessionId: live.id, status: "RUNNING" },
      select: { id: true }
    });

    for (const auction of runningAuctions) {
      await closeAuction(auction.id);
    }

    const updated = await prisma.liveSession.update({
      where: { id: live.id },
      data: {
        status: "ENDED",
        endedAt: new Date(),
        activeAuctionProductId: null,
        currentProductId: null,
        streamStatus: "未推流"
      },
      include: liveInclude
    });

    await emitLiveSessions(res.locals.user.id);
    await emitLiveSessionState(updated.id);
    res.json({ live: updated });
  })
);

router.post(
  "/:id/current-product",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const productId = String(req.body.productId ?? "");
    const live = await loadLive(req.params.id, res.locals.user.id);
    if (!live || live.status !== "LIVE") {
      res.status(404).json({ message: "直播不存在或未开始" });
      return;
    }
    if (live.activeAuctionProductId && live.activeAuctionProductId !== productId) {
      res.status(409).json({ message: "当前已有拍品正在竞拍，请先结束本轮" });
      return;
    }
    if (!productIdsOf(live).includes(productId)) {
      res.status(400).json({ message: "该商品不在当前直播拍品队列中" });
      return;
    }
    if (live.auctions.some((auction) => auction.productId === productId && auction.status === "ENDED")) {
      res.status(409).json({ message: "已结束的拍品不能重新设为当前拍品" });
      return;
    }

    const updated = await prisma.liveSession.update({
      where: { id: live.id },
      data: { currentProductId: productId },
      include: liveInclude
    });

    await emitLiveSessionState(updated.id);
    res.json({ live: updated });
  })
);

export default router;
