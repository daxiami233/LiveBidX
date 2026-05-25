import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { emitAuctionState } from "../../realtime/auctionGateway.js";
import { asyncHandler } from "../../utils/http.js";
import { OrderServiceError, payCustomerOrder } from "./order.service.js";

const router = Router();

const orderInclude = {
  address: true,
  product: true,
  auction: {
    include: {
      liveSession: { select: { id: true, title: true } },
      host: { select: { id: true, nickname: true } },
      highestBidder: { select: { id: true, nickname: true } }
    }
  }
};

router.get(
  "/host",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (_req, res) => {
    const orders = await prisma.order.findMany({
      where: { auction: { hostId: res.locals.user.id } },
      orderBy: { createdAt: "desc" },
      include: orderInclude
    });

    res.json({ orders });
  })
);

router.get(
  "/my",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { buyerId: res.locals.user.id },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: orderInclude
    });

    res.json({ orders });
  })
);

router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const role = res.locals.user.role;
    const order = await prisma.order.findFirst({
      where: {
        id: req.params.id,
        ...(role === "HOST" ? { auction: { hostId: res.locals.user.id } } : { buyerId: res.locals.user.id })
      },
      include: orderInclude
    });

    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }

    res.json({ order });
  })
);

// 普通用户支付自己的待支付订单。
router.post(
  "/:id/pay",
  requireAuth,
  requireRole("CUSTOMER"),
  asyncHandler(async (req, res) => {
    try {
      const paidOrder = await payCustomerOrder(req.params.id, res.locals.user.id, orderInclude);
      res.json({ order: paidOrder, message: paidOrder.status === "PAID" ? "支付成功" : "订单已支付" });
    } catch (error) {
      if (error instanceof OrderServiceError) {
        res.status(error.statusCode).json({ message: error.message });
        return;
      }
      throw error;
    }
  })
);

router.post(
  "/:id/cancel",
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
    if (order.status !== "PENDING_PAYMENT") {
      res.status(409).json({ message: "只有待支付订单可以取消" });
      return;
    }

    const cancelled = await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
      include: orderInclude
    });

    await emitAuctionState(cancelled.auctionId);
    res.json({ order: cancelled, message: "订单已取消" });
  })
);

router.post(
  "/:id/close",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, auction: { hostId: res.locals.user.id } },
      include: orderInclude
    });

    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }
    if (order.status !== "PENDING_PAYMENT") {
      res.status(409).json({ message: "只有待支付订单可以关闭" });
      return;
    }

    const closed = await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
      include: orderInclude
    });

    await emitAuctionState(closed.auctionId);
    res.json({ order: closed, message: "订单已关闭" });
  })
);

router.post(
  "/:id/ship",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, auction: { hostId: res.locals.user.id } },
      include: orderInclude
    });

    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }
    if (order.status !== "PAID") {
      res.status(409).json({ message: "只有已支付订单可以发货" });
      return;
    }
    const company = typeof req.body.company === "string" ? req.body.company.trim() : "";
    const trackingNo = typeof req.body.trackingNo === "string" ? req.body.trackingNo.trim() : "";
    if (!company || !trackingNo) {
      res.status(400).json({ message: "物流公司和运单号不能为空" });
      return;
    }

    const shipped = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: "SHIPPED",
        shippingCompany: company,
        trackingNo,
        shippedAt: new Date()
      },
      include: orderInclude
    });

    res.json({
      order: shipped,
      logistics: {
        company: shipped.shippingCompany,
        trackingNo: shipped.trackingNo,
        shippedAt: shipped.shippedAt
      },
      message: "发货成功"
    });
  })
);

router.post(
  "/:id/complete",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, auction: { hostId: res.locals.user.id } }
    });

    if (!order) {
      res.status(404).json({ message: "订单不存在或无权限" });
      return;
    }
    if (!["PAID", "SHIPPED"].includes(order.status)) {
      res.status(409).json({ message: "当前订单状态不能完成" });
      return;
    }

    const completed = await prisma.order.update({
      where: { id: order.id },
      data: { status: "COMPLETED" },
      include: orderInclude
    });

    res.json({ order: completed, message: "订单已完成" });
  })
);

export default router;
