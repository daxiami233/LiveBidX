-- Extend existing status enums for the merchant admin workflow.
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'REVIEWING';
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SHIPPED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

CREATE TYPE "LiveSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED');

ALTER TABLE "Product"
ADD COLUMN "capPrice" INTEGER,
ADD COLUMN "durationSec" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN "autoExtendSec" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN "plannedAt" TIMESTAMP(3);

CREATE TABLE "LiveSession" (
  "id" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "status" "LiveSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "coverImage" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "onlineCount" INTEGER NOT NULL DEFAULT 0,
  "networkStatus" TEXT NOT NULL DEFAULT '良好',
  "streamStatus" TEXT NOT NULL DEFAULT '未推流',
  "currentProductId" TEXT,
  "activeAuctionProductId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveProduct" (
  "id" TEXT NOT NULL,
  "liveSessionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveProduct_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Auction" ADD COLUMN "liveSessionId" TEXT;

CREATE UNIQUE INDEX "LiveSession_roomId_key" ON "LiveSession"("roomId");
CREATE INDEX "LiveSession_hostId_idx" ON "LiveSession"("hostId");
CREATE INDEX "LiveSession_status_idx" ON "LiveSession"("status");
CREATE UNIQUE INDEX "LiveProduct_liveSessionId_productId_key" ON "LiveProduct"("liveSessionId", "productId");
CREATE INDEX "LiveProduct_productId_idx" ON "LiveProduct"("productId");
CREATE INDEX "LiveProduct_liveSessionId_sortOrder_idx" ON "LiveProduct"("liveSessionId", "sortOrder");
CREATE INDEX "Auction_liveSessionId_idx" ON "Auction"("liveSessionId");

ALTER TABLE "LiveSession"
ADD CONSTRAINT "LiveSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LiveProduct"
ADD CONSTRAINT "LiveProduct_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "LiveProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Auction"
ADD CONSTRAINT "Auction_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
