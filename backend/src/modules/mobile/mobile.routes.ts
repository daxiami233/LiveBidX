import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { asyncHandler } from "../../utils/http.js";

const router = Router();

const productSelect = {
  id: true,
  title: true,
  imageUrl: true,
  startPrice: true,
  minIncrement: true,
  capPrice: true,
  durationSec: true,
  category: true,
  description: true
};

const orderInclude = {
  product: { select: productSelect },
  auction: {
    include: {
      liveSession: { select: { id: true, title: true, roomId: true } },
      bids: {
        orderBy: { amount: "desc" as const },
        take: 20,
        include: { user: { select: { id: true, nickname: true } } }
      }
    }
  }
};

function moneyValue(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function toneFromId(id: string) {
  const tones = ["ivory", "mint", "jade", "violet"];
  return tones[Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tones.length];
}

function statusToOrderLabel(status: string) {
  const map: Record<string, string> = {
    PENDING_PAYMENT: "待支付",
    PAID: "待发货",
    SHIPPED: "已发货",
    COMPLETED: "已完成",
    CANCELLED: "已取消"
  };
  return map[status] ?? "待支付";
}

function statusToBidLabel(status: string, won: boolean, hasBid: boolean) {
  if (status === "RUNNING") return "竞拍中";
  if (won) return "已拍中";
  if (hasBid) return "未拍中";
  return "已取消";
}

function productDto(product: any) {
  return {
    id: product.id,
    name: product.title,
    lotNo: `Lot.${product.id.slice(-8)}`,
    description: product.description ?? undefined,
    imageUrl: product.imageUrl,
    imageTone: toneFromId(product.id),
    startPrice: product.startPrice,
    currentPrice: product.currentPrice ?? product.startPrice,
    nextPrice: (product.currentPrice ?? product.startPrice) + product.minIncrement,
    increment: product.minIncrement,
    capPrice: product.capPrice ?? product.startPrice * 3,
    countdown: product.countdown ?? "即将开始",
    leader: product.leader ?? "-"
  };
}

function orderDto(order: any) {
  const hasLogistics = Boolean(order.shippingCompany && order.trackingNo);
  const paidAtText = order.status === "PENDING_PAYMENT" ? "待支付" : "已确认";

  return {
    id: order.id,
    status: statusToOrderLabel(order.status),
    liveTitle: order.auction?.liveSession?.title ?? "直播拍卖",
    product: productDto({
      ...order.product,
      currentPrice: order.amount,
      countdown: paidAtText
    }),
    paidAmount: order.amount,
    logistics: hasLogistics ? {
      company: order.shippingCompany,
      trackingNo: order.trackingNo,
      steps: [
        { time: order.shippedAt ? order.shippedAt.toISOString() : order.updatedAt.toISOString(), text: "商家已发货，物流信息已同步" }
      ]
    } : undefined
  };
}

function auctionProductDto(auction: any) {
  return productDto({
    ...auction.product,
    currentPrice: auction.currentPrice,
    countdown: auction.status === "RUNNING" && auction.endTime ? formatCountdown(auction.endTime) : auction.status === "RUNNING" ? "竞拍中" : "已结束",
    leader: auction.highestBidder?.nickname ?? "-"
  });
}

function formatCountdown(endTime: Date) {
  const remaining = Math.max(0, endTime.getTime() - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `00:${minutes}:${seconds}`;
}

function liveRoomDto(live: any) {
  const runningAuction = live.auctions.find((auction: any) => auction.status === "RUNNING");
  const currentProduct = runningAuction?.product
    ?? live.products.find((item: any) => item.productId === live.currentProductId)?.product
    ?? (live.status === "SCHEDULED" ? live.products[0]?.product : null);

  return {
    id: live.id,
    title: live.title,
    merchant: live.host?.nickname ?? "商家",
    status: live.status === "LIVE" ? "live" : "upcoming",
    coverTone: toneFromId(live.id),
    viewers: String(Math.max(live.onlineCount, 0)),
    heatRank: live.status === "LIVE" ? "实时热拍" : "预约中",
    soldCount: live.auctions.filter((auction: any) => auction.order).length,
    startsAt: live.status === "LIVE" ? "直播中" : live.scheduledAt.toISOString(),
    currentProduct: currentProduct ? productDto({
      ...currentProduct,
      currentPrice: runningAuction?.currentPrice ?? currentProduct.startPrice,
      countdown: runningAuction ? formatCountdown(runningAuction.endTime ?? new Date()) : "即将开始",
      leader: runningAuction?.highestBidder?.nickname ?? "-"
    }) : null,
    auctionId: runningAuction?.id ?? null
  };
}

router.get(
  "/live-rooms",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (_req, res) => {
    const lives = await prisma.liveSession.findMany({
      where: { status: { in: ["LIVE", "SCHEDULED"] } },
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
      include: {
        host: { select: { id: true, nickname: true } },
        products: { orderBy: { sortOrder: "asc" }, include: { product: { select: productSelect } } },
        auctions: {
          orderBy: { createdAt: "desc" },
          include: {
            product: { select: productSelect },
            highestBidder: { select: { id: true, nickname: true } },
            order: true
          }
        }
      }
    });

    res.json({ rooms: lives.map(liveRoomDto).filter((room) => room.currentProduct) });
  })
);

router.get(
  "/live-rooms/:id",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const live = await prisma.liveSession.findUnique({
      where: { id: req.params.id },
      include: {
        host: { select: { id: true, nickname: true } },
        products: { orderBy: { sortOrder: "asc" }, include: { product: { select: productSelect } } },
        auctions: {
          orderBy: { createdAt: "desc" },
          include: {
            product: { select: productSelect },
            highestBidder: { select: { id: true, nickname: true } },
            bids: { orderBy: { amount: "desc" }, take: 20, include: { user: { select: { id: true, nickname: true } } } },
            order: true
          }
        }
      }
    });

    if (!live) {
      res.status(404).json({ message: "直播间不存在" });
      return;
    }

    const room = liveRoomDto(live);
    const queue = live.products.map((item: any) => productDto(item.product));
    const runningAuction = live.auctions.find((auction: any) => auction.status === "RUNNING");
    const ranking = (runningAuction?.bids ?? []).map((bid: any, index: number) => ({
      rank: index + 1,
      user: bid.user.nickname,
      price: bid.amount,
      count: 1,
      status: index === 0 ? "领先中" : "已被超越",
      mine: bid.userId === res.locals.user.id
    }));

    res.json({ room, queue, ranking, auction: runningAuction ?? null });
  })
);

router.get(
  "/orders",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (_req, res) => {
    const orders = await prisma.order.findMany({
      where: { buyerId: res.locals.user.id },
      orderBy: { createdAt: "desc" },
      include: orderInclude
    });

    res.json({ orders: orders.map(orderDto) });
  })
);

router.get(
  "/orders/:id",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, buyerId: res.locals.user.id },
      include: orderInclude
    });

    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }

    res.json({ order: orderDto(order) });
  })
);

router.post(
  "/orders/:id/pay",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({ where: { id: req.params.id, buyerId: res.locals.user.id } });
    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }
    if (order.status !== "PENDING_PAYMENT") {
      res.status(409).json({ message: "当前订单不需要支付" });
      return;
    }
    const updated = await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" }, include: orderInclude });
    res.json({ order: orderDto(updated), message: "支付成功" });
  })
);

router.post(
  "/orders/:id/complete",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({ where: { id: req.params.id, buyerId: res.locals.user.id } });
    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }
    if (order.status !== "SHIPPED") {
      res.status(409).json({ message: "只有已发货订单可以确认收货" });
      return;
    }
    const updated = await prisma.order.update({ where: { id: order.id }, data: { status: "COMPLETED" }, include: orderInclude });
    res.json({ order: orderDto(updated), message: "已确认收货" });
  })
);

router.get(
  "/bid-history",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (_req, res) => {
    const auctions = await prisma.auction.findMany({
      where: { bids: { some: { userId: res.locals.user.id } } },
      orderBy: { updatedAt: "desc" },
      include: {
        product: { select: productSelect },
        highestBidder: { select: { id: true, nickname: true } },
        bids: { where: { userId: res.locals.user.id }, orderBy: { createdAt: "desc" } }
      }
    });

    res.json({
      items: auctions.map((auction) => {
        const myBid = auction.bids[0];
        return {
          id: auction.id,
          status: statusToBidLabel(auction.status, auction.highestBidderId === res.locals.user.id, auction.bids.length > 0),
          product: auctionProductDto(auction),
          myBid: myBid?.amount ?? auction.startPrice,
          bidCount: auction.bids.length
        };
      })
    });
  })
);

router.get(
  "/addresses",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (_req, res) => {
    const addresses = await prisma.address.findMany({
      where: { userId: res.locals.user.id },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });

    res.json({ addresses });
  })
);

router.post(
  "/addresses",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name ?? "").trim();
    const phone = String(req.body.phone ?? "").trim();
    const detail = String(req.body.detail ?? "").trim();
    if (!name || !phone || !detail) {
      res.status(400).json({ message: "请填写完整收货地址" });
      return;
    }

    const count = await prisma.address.count({ where: { userId: res.locals.user.id } });
    const address = await prisma.address.create({
      data: { userId: res.locals.user.id, name, phone, detail, isDefault: count === 0 }
    });

    res.status(201).json({ address });
  })
);

router.patch(
  "/addresses/:id",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const address = await prisma.address.findFirst({ where: { id: req.params.id, userId: res.locals.user.id } });
    if (!address) {
      res.status(404).json({ message: "地址不存在或无权限" });
      return;
    }

    const updated = await prisma.address.update({
      where: { id: address.id },
      data: {
        name: req.body.name === undefined ? undefined : String(req.body.name).trim(),
        phone: req.body.phone === undefined ? undefined : String(req.body.phone).trim(),
        detail: req.body.detail === undefined ? undefined : String(req.body.detail).trim()
      }
    });

    res.json({ address: updated });
  })
);

router.post(
  "/addresses/:id/default",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const address = await prisma.address.findFirst({ where: { id: req.params.id, userId: res.locals.user.id } });
    if (!address) {
      res.status(404).json({ message: "地址不存在或无权限" });
      return;
    }

    await prisma.$transaction([
      prisma.address.updateMany({ where: { userId: res.locals.user.id }, data: { isDefault: false } }),
      prisma.address.update({ where: { id: address.id }, data: { isDefault: true } })
    ]);

    const addresses = await prisma.address.findMany({
      where: { userId: res.locals.user.id },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
    });

    res.json({ addresses });
  })
);

export default router;
