import { prisma } from "../../config/prisma.js";

export type ExpiredAuctionInfo = {
  id: string;
  liveSessionId: string | null;
  productId: string;
};

export class AuctionExpiredError extends Error {
  auction: ExpiredAuctionInfo;

  constructor(auction: ExpiredAuctionInfo) {
    super("竞拍已结束");
    this.auction = auction;
  }
}

export async function closeAuction(auctionId: string, overrideEndTime?: Date) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.auction.updateMany({
      where: { id: auctionId, status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "ENDED",
        ...(overrideEndTime ? { endTime: overrideEndTime } : {})
      }
    });

    const fresh = await tx.auction.findUnique({
      where: { id: auctionId },
      include: { order: true }
    });

    if (result.count === 0 || !fresh) return fresh;

    if (fresh.highestBidderId && !fresh.order) {
      await tx.order.create({
        data: {
          auctionId: fresh.id,
          productId: fresh.productId,
          buyerId: fresh.highestBidderId,
          amount: fresh.currentPrice
        }
      });
    }

    return tx.auction.findUnique({
      where: { id: auctionId },
      include: { order: true }
    });
  });
}

export async function nextAvailableProductId(liveSessionId: string, finishedProductId: string) {
  const live = await prisma.liveSession.findUnique({
    where: { id: liveSessionId },
    include: {
      products: { orderBy: { sortOrder: "asc" }, select: { productId: true } },
      auctions: { select: { productId: true, status: true } }
    }
  });

  if (!live) return null;

  const productIds = live.products.map((item) => item.productId);
  const finishedIndex = productIds.indexOf(finishedProductId);
  const unavailableProductIds = new Set(
    live.auctions
      .filter((auction) => auction.status === "ENDED" || auction.status === "RUNNING")
      .map((auction) => auction.productId)
  );

  return productIds.find((productId, index) => index > finishedIndex && !unavailableProductIds.has(productId))
    ?? productIds.find((productId) => !unavailableProductIds.has(productId))
    ?? null;
}

export async function advanceLiveAfterAuction(liveSessionId: string, finishedProductId: string) {
  const nextProductId = await nextAvailableProductId(liveSessionId, finishedProductId);
  return prisma.liveSession.update({
    where: { id: liveSessionId },
    data: {
      activeAuctionProductId: null,
      currentProductId: nextProductId
    }
  });
}
