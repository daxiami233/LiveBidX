import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/role.js";
import { asyncHandler, toDate, toInt } from "../../utils/http.js";

const router = Router();
const pendingStatuses = ["DRAFT", "REVIEWING", "ARCHIVED"] as const;

const productInclude = {
  liveItems: {
    include: {
      liveSession: { select: { id: true, title: true, status: true, scheduledAt: true } }
    }
  },
  auctions: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: {
      order: true,
      _count: { select: { bids: true } }
    }
  }
};

// 获取当前主播创建的商品列表，覆盖已上架、待上架和已拍卖视图。
router.get(
  "/my",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const tab = String(req.query.tab ?? "all");
    const status =
      tab === "pending"
        ? { in: [...pendingStatuses] }
        : tab === "listed"
          ? { equals: "ACTIVE" as const }
          : undefined;

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize ?? 50)));
    const where = { hostId: res.locals.user.id, status };
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
      where: { hostId: res.locals.user.id, status },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: productInclude
    })
    ]);

    res.json({ products, pagination: { page, pageSize, total } });
  })
);

router.get(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id },
      include: productInclude
    });

    if (!product) {
      res.status(404).json({ message: "商品不存在或无权限" });
      return;
    }

    res.json({ product });
  })
);

// 主播创建一个新的竞拍商品。
router.post(
  "/",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const { title, category, imageUrl, description, estimate } = req.body as Record<string, unknown>;
    const startPrice = toInt(req.body.startPrice);
    const deposit = toInt(req.body.deposit, 0);
    const minIncrement = toInt(req.body.minIncrement ?? req.body.increment);
    const capPrice = req.body.capPrice === undefined ? null : toInt(req.body.capPrice);
    const durationSec = toInt(req.body.durationSec ?? Number(req.body.duration ?? 5) * 60, 300);
    const autoExtendSec = toInt(req.body.autoExtendSec ?? req.body.autoExtend, 15);
    const plannedAt = toDate(req.body.plannedAt ?? req.body.plannedTime);
    const mode = String(req.body.mode ?? "draft");

    if (!String(title ?? "").trim() || !String(category ?? "").trim() || !String(imageUrl ?? "").trim()) {
      res.status(400).json({ message: "请填写商品名称、分类和图片地址" });
      return;
    }

    if (startPrice <= 0 || deposit < 0 || minIncrement <= 0) {
      res.status(400).json({ message: "起拍价、保证金和加价幅度必须是有效数字" });
      return;
    }
    if (capPrice !== null && capPrice <= startPrice) {
      res.status(400).json({ message: "封顶价必须大于起拍价" });
      return;
    }
    if (capPrice !== null && capPrice < startPrice + minIncrement) {
      res.status(400).json({ message: "封顶价必须不低于起拍价加一个加价幅度" });
      return;
    }

    const product = await prisma.product.create({
      data: {
        hostId: res.locals.user.id,
        title: String(title).trim(),
        category: String(category).trim(),
        imageUrl: String(imageUrl).trim(),
        description: String(description ?? "").trim() || null,
        estimate: String(estimate ?? "").trim() || null,
        startPrice,
        deposit,
        minIncrement,
        capPrice,
        durationSec,
        autoExtendSec,
        plannedAt,
        status: mode === "submit" ? "REVIEWING" : "DRAFT"
      }
    });

    res.status(201).json({ product });
  })
);

router.patch(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id },
      include: { auctions: { where: { status: "RUNNING" } } }
    });

    if (!product) {
      res.status(404).json({ message: "商品不存在或无权限" });
      return;
    }
    if (product.auctions.length) {
      res.status(409).json({ message: "正在竞拍的商品不能修改核心规则" });
      return;
    }

    const nextStartPrice = req.body.startPrice === undefined ? product.startPrice : toInt(req.body.startPrice);
    const nextMinIncrement = req.body.minIncrement === undefined && req.body.increment === undefined ? product.minIncrement : toInt(req.body.minIncrement ?? req.body.increment);
    const nextCapPrice = req.body.capPrice === undefined ? product.capPrice : toInt(req.body.capPrice);
    if (nextCapPrice !== null && nextCapPrice <= nextStartPrice) {
      res.status(400).json({ message: "封顶价必须大于起拍价" });
      return;
    }
    if (nextCapPrice !== null && nextCapPrice < nextStartPrice + nextMinIncrement) {
      res.status(400).json({ message: "封顶价必须不低于起拍价加一个加价幅度" });
      return;
    }

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: {
        title: req.body.title === undefined ? undefined : String(req.body.title).trim(),
        category: req.body.category === undefined ? undefined : String(req.body.category).trim(),
        imageUrl: req.body.imageUrl === undefined ? undefined : String(req.body.imageUrl).trim(),
        description: req.body.description === undefined ? undefined : String(req.body.description).trim() || null,
        estimate: req.body.estimate === undefined ? undefined : String(req.body.estimate).trim() || null,
        startPrice: req.body.startPrice === undefined ? undefined : toInt(req.body.startPrice),
        minIncrement: req.body.minIncrement === undefined && req.body.increment === undefined ? undefined : toInt(req.body.minIncrement ?? req.body.increment),
        deposit: req.body.deposit === undefined ? undefined : toInt(req.body.deposit, 0),
        capPrice: req.body.capPrice === undefined ? undefined : toInt(req.body.capPrice),
        durationSec: req.body.durationSec === undefined && req.body.duration === undefined ? undefined : toInt(req.body.durationSec ?? Number(req.body.duration) * 60, 300),
        autoExtendSec: req.body.autoExtendSec === undefined && req.body.autoExtend === undefined ? undefined : toInt(req.body.autoExtendSec ?? req.body.autoExtend, 15),
        plannedAt: req.body.plannedAt === undefined && req.body.plannedTime === undefined ? undefined : toDate(req.body.plannedAt ?? req.body.plannedTime),
        status: req.body.mode === "submit" ? "REVIEWING" : undefined
      },
      include: productInclude
    });

    res.json({ product: updated });
  })
);

router.post(
  "/:id/review",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const approved = Boolean(req.body.approved);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id, status: "REVIEWING" }
    });

    if (!product) {
      res.status(404).json({ message: "待审核商品不存在或无权限" });
      return;
    }

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { status: approved ? "DRAFT" : "ARCHIVED" },
      include: productInclude
    });

    res.json({ product: updated, message: approved ? "审核通过，商品进入待上架" : "商品已驳回" });
  })
);

// 主播删除商品：无竞拍历史时硬删除，有历史时下架保留记录。
router.delete(
  "/:id",
  requireAuth,
  requireRole("HOST"),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, hostId: res.locals.user.id },
      include: { auctions: { select: { id: true, status: true } } }
    });

    if (!product) {
      res.status(404).json({ message: "商品不存在或无权限" });
      return;
    }

    if (product.auctions.some((auction) => auction.status === "RUNNING")) {
      res.status(409).json({ message: "商品正在竞拍中，落锤后才能删除" });
      return;
    }

    if (product.auctions.length > 0) {
      const archived = await prisma.product.update({
        where: { id: product.id },
        data: { status: "ARCHIVED" }
      });

      res.json({ product: archived, mode: "ARCHIVED", message: "商品已有竞拍记录，已下架并保留历史数据" });
      return;
    }

    const deleted = await prisma.product.delete({ where: { id: product.id } });
    res.json({ product: deleted, mode: "DELETED", message: "商品已删除" });
  })
);

export default router;
