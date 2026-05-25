import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import {
  acquireAuctionLock,
  cacheAuctionState,
  emitAuctionEnded,
  emitAuctionState,
  emitLiveAuctions,
  emitLiveSessionState,
  releaseAuctionLock
} from "../../realtime/auctionGateway.js";
import { calculateBidUpdate } from "./bidRules.js";
import { advanceLiveAfterAuction, AuctionExpiredError, closeAuction } from "./auction.service.js";

const router = Router();

// 包装异步路由，把异常交给 Express 统一错误处理中间件。
function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

// 把 Prisma 查询结果整理成前端需要的竞拍 DTO。
function toAuctionDto(auction: any) {
  return {
    ...auction,
    bidCount: auction._count?.bids ?? auction.bids?.length ?? 0,
    bids: auction.bids ?? undefined,
    _count: undefined
  };
}

// 获取直播大厅中正在进行的竞拍。
router.get(
  "/live",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const auctions = await prisma.auction.findMany({
      where: { status: "RUNNING" },
      orderBy: { createdAt: "desc" },
      include: {
        product: true,
        liveSession: true,
        host: { select: { id: true, nickname: true } },
        highestBidder: { select: { id: true, nickname: true } },
        _count: { select: { bids: true } }
      }
    });

    res.json({ auctions: auctions.map(toAuctionDto) });
  })
);

// 获取当前主播创建过的竞拍。
router.get(
  "/host",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (_req, res) => {
    const page = Math.max(1, Number(_req.query.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(_req.query.pageSize ?? 50)));
    const [total, auctions] = await Promise.all([
      prisma.auction.count({ where: { hostId: res.locals.user.id } }),
      prisma.auction.findMany({
      where: { hostId: res.locals.user.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: true,
        liveSession: true,
        highestBidder: { select: { id: true, nickname: true } },
        bids: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { user: { select: { id: true, nickname: true } } }
        },
        order: true,
        _count: { select: { bids: true } }
      }
    })
    ]);

    res.json({ auctions: auctions.map(toAuctionDto), pagination: { page, pageSize, total } });
  })
);

// 获取单场竞拍详情，并在超时时自动落锤。
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const auction = await prisma.auction.findUnique({
      where: { id: req.params.id },
      include: {
        product: true,
        liveSession: true,
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

    if (!auction) {
      res.status(404).json({ message: "竞拍不存在" });
      return;
    }

    if (auction.status === "RUNNING" && auction.endTime && auction.endTime.getTime() <= Date.now()) {
      await closeAuction(auction.id);
      if (auction.liveSessionId) {
        await advanceLiveAfterAuction(auction.liveSessionId, auction.productId);
        await emitLiveSessionState(auction.liveSessionId);
      }
      await emitAuctionEnded(auction.id);
      const endedAuction = await prisma.auction.findUnique({
        where: { id: req.params.id },
        include: {
          product: true,
          liveSession: true,
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
      res.json({ auction: toAuctionDto(endedAuction) });
      return;
    }

    res.json({ auction: toAuctionDto(auction) });
  })
);

// 主播基于商品创建并开始一场竞拍。
router.post(
  "/",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const productId = String(req.body.productId ?? "");
    const liveSessionId = req.body.liveSessionId ? String(req.body.liveSessionId) : null;

    const product = await prisma.product.findFirst({
      where: { id: productId, hostId: res.locals.user.id, status: "ACTIVE" }
    });

    if (!product) {
      res.status(404).json({ message: "商品不存在或无权限" });
      return;
    }

    const durationSeconds = Math.max(30, Math.min(7200, Number(req.body.durationSeconds ?? product.durationSec)));

    const running = await prisma.auction.findFirst({
      where: { productId, status: "RUNNING" }
    });

    if (running) {
      res.status(409).json({ message: "该商品已有正在进行的竞拍" });
      return;
    }

    let live: any = null;
    if (liveSessionId) {
      live = await prisma.liveSession.findFirst({
        where: { id: liveSessionId, hostId: res.locals.user.id, status: "LIVE" },
        include: { products: true }
      });
      if (!live) {
        res.status(404).json({ message: "直播不存在或未开始" });
        return;
      }
      if (!live.products.some((item: any) => item.productId === product.id)) {
        res.status(400).json({ message: "该商品不在当前直播拍品队列中" });
        return;
      }
      if (live.currentProductId !== product.id) {
        res.status(409).json({ message: "开始竞拍只能对当前讲解商品使用" });
        return;
      }
      if (live.activeAuctionProductId) {
        res.status(409).json({ message: "同一时间只能有一个拍品正在竞拍" });
        return;
      }
      const finishedAuction = await prisma.auction.findFirst({
        where: { liveSessionId: live.id, productId: product.id, status: "ENDED" }
      });
      if (finishedAuction) {
        res.status(409).json({ message: "该拍品本场直播已完成竞拍，不能重复开拍" });
        return;
      }
    }

    const now = new Date();
    const auction = await prisma.auction.create({
      data: {
        productId: product.id,
        hostId: res.locals.user.id,
        liveSessionId,
        status: "RUNNING",
        startPrice: product.startPrice,
        currentPrice: product.startPrice,
        minIncrement: product.minIncrement,
        capPrice: product.capPrice,
        autoExtendSec: product.autoExtendSec,
        deposit: product.deposit,
        startTime: now,
        endTime: new Date(now.getTime() + durationSeconds * 1000)
      },
      include: {
        product: true,
        liveSession: true,
        highestBidder: { select: { id: true, nickname: true } },
        _count: { select: { bids: true } }
      }
    });

    if (live) {
      await prisma.liveSession.update({
        where: { id: live.id },
        data: { activeAuctionProductId: product.id, currentProductId: product.id }
      });
      await emitLiveSessionState(live.id);
    }

    await cacheAuctionState(auction);
    await emitLiveAuctions();
    await emitAuctionState(auction.id);

    res.status(201).json({ auction: toAuctionDto(auction) });
  })
);

// 主播手动落锤结束竞拍。
router.post(
  "/:id/end",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const auction = await prisma.auction.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id },
      include: { product: true, liveSession: true, highestBidder: { select: { id: true, nickname: true } }, order: true, _count: { select: { bids: true } } }
    });

    if (!auction) {
      res.status(404).json({ message: "竞拍不存在或无权限" });
      return;
    }

    await closeAuction(auction.id, new Date());

    if (auction.liveSessionId) {
      await advanceLiveAfterAuction(auction.liveSessionId, auction.productId);
      await emitLiveSessionState(auction.liveSessionId);
    }

    const ended = await prisma.auction.findUnique({
      where: { id: auction.id },
      include: { product: true, liveSession: true, highestBidder: { select: { id: true, nickname: true } }, order: true, _count: { select: { bids: true } } }
    });

    await emitAuctionEnded(auction.id);

    res.json({ auction: toAuctionDto(ended) });
  })
);

router.post(
  "/:id/cancel",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const auction = await prisma.auction.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id },
      include: { product: true, liveSession: true, highestBidder: { select: { id: true, nickname: true } }, _count: { select: { bids: true } } }
    });

    if (!auction) {
      res.status(404).json({ message: "竞拍不存在或无权限" });
      return;
    }
    if (auction.status !== "RUNNING") {
      res.status(409).json({ message: "只有正在竞拍的拍品可以取消" });
      return;
    }

    const cancelled = await prisma.auction.update({
      where: { id: auction.id },
      data: { status: "CANCELLED", endTime: new Date() },
      include: { product: true, liveSession: true, highestBidder: { select: { id: true, nickname: true } }, _count: { select: { bids: true } } }
    });

    if (auction.liveSessionId) {
      await advanceLiveAfterAuction(auction.liveSessionId, auction.productId);
      await emitLiveSessionState(auction.liveSessionId);
    }

    await emitAuctionEnded(auction.id);
    res.json({ auction: toAuctionDto(cancelled), message: "竞拍已取消" });
  })
);

router.post(
  "/:id/extend",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const seconds = Math.max(10, Math.min(300, Number(req.body.seconds ?? 30)));
    const auction = await prisma.auction.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id, status: "RUNNING" }
    });

    if (!auction) {
      res.status(404).json({ message: "竞拍不存在、已结束或无权限" });
      return;
    }

    const base = auction.endTime && auction.endTime.getTime() > Date.now() ? auction.endTime : new Date();
    const updated = await prisma.auction.update({
      where: { id: auction.id },
      data: { endTime: new Date(base.getTime() + seconds * 1000) },
      include: {
        product: true,
        liveSession: true,
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

    await cacheAuctionState(updated);
    await emitAuctionState(updated.id, "auction_extended");
    res.json({ auction: toAuctionDto(updated), message: `已延长 ${seconds} 秒` });
  })
);

// 普通用户通过 HTTP 兜底出价。
router.post(
  "/:id/bids",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount)) {
      res.status(400).json({ message: "出价金额无效" });
      return;
    }

    const { lockId } = await acquireAuctionLock(req.params.id);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const auction = await tx.auction.findUnique({
          where: { id: req.params.id }
        });

        if (!auction || auction.status !== "RUNNING") {
          throw new Error("竞拍未开始或已结束");
        }

        if (auction.endTime && auction.endTime.getTime() <= Date.now()) {
          throw new AuctionExpiredError({ id: auction.id, liveSessionId: auction.liveSessionId, productId: auction.productId });
        }

        const bidUpdate = calculateBidUpdate({
          amount,
          currentPrice: auction.currentPrice,
          minIncrement: auction.minIncrement,
          capPrice: auction.capPrice,
          endTime: auction.endTime,
          autoExtendSec: auction.autoExtendSec
        });

        await tx.bid.create({
          data: {
            auctionId: auction.id,
            userId: res.locals.user.id,
            amount: bidUpdate.amount
          },
        });

        const updated = await tx.auction.updateMany({
          where: { id: auction.id, status: "RUNNING" },
          data: {
            currentPrice: bidUpdate.amount,
            highestBidderId: res.locals.user.id,
            endTime: bidUpdate.nextEndTime
          }
        });
        if (updated.count === 0) {
          throw new Error("竞拍已结束");
        }

        const updatedAuction = await tx.auction.findUnique({
          where: { id: auction.id },
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
        if (!updatedAuction) throw new Error("竞拍不存在");
        return updatedAuction;
      }).catch(async (error) => {
        if (error instanceof AuctionExpiredError) {
          await closeAuction(error.auction.id);
          if (error.auction.liveSessionId) {
            await advanceLiveAfterAuction(error.auction.liveSessionId, error.auction.productId);
            await emitLiveSessionState(error.auction.liveSessionId);
          }
          await emitAuctionEnded(error.auction.id);
        }
        throw error;
      });

      if (result.capPrice && result.currentPrice >= result.capPrice) {
        await closeAuction(result.id, new Date());
        if (result.liveSessionId) {
          await advanceLiveAfterAuction(result.liveSessionId, result.productId);
          await emitLiveSessionState(result.liveSessionId);
        }
        await emitAuctionEnded(result.id);
        const ended = await prisma.auction.findUnique({
          where: { id: result.id },
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
        res.status(201).json({ auction: toAuctionDto(ended) });
        return;
      }

      await cacheAuctionState(result);
      await emitAuctionState(result.id, "bid_update");
      await emitLiveAuctions();

      res.status(201).json({ auction: toAuctionDto(result) });
    } finally {
      await releaseAuctionLock(req.params.id, lockId);
    }
  })
);

export default router;
