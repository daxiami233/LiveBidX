import { randomUUID } from "node:crypto";
import { hashPassword } from "../../backend/src/utils/password.js";
import { createToken } from "../../backend/src/utils/token.js";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

export const isTestDatabase = Boolean(process.env.DATABASE_URL?.includes("test"));
export const describeDb = isTestDatabase ? describe : describe.skip;

export const { prisma } = await import("../../backend/src/config/prisma.js");
export const { app, server, runExpiredAuctionSweep, startExpiredAuctionScheduler, shutdown } = await import("../../backend/src/server.js");
export const { getRealtimeServer, initializeRealtime, resetRateLimits } = await import("../../backend/src/realtime/auctionGateway.js");

export async function resetDb() {
  if (!isTestDatabase) return;
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "LiveComment",
      "LiveProduct",
      "Order",
      "Bid",
      "Auction",
      "Address",
      "Product",
      "LiveSession",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

export async function createUser(role: "CUSTOMER" | "HOST", email = `${role.toLowerCase()}-${randomUUID()}@test.local`) {
  const { hash, salt } = hashPassword("password123");
  const nicknameSuffix = email.split("@")[0].slice(-8);
  const user = await prisma.user.create({
    data: {
      nickname: role === "HOST" ? `测试商家-${nicknameSuffix}` : `测试买家-${nicknameSuffix}`,
      email,
      passwordHash: hash,
      passwordSalt: salt,
      role
    }
  });
  return { user, token: createToken({ userId: user.id, role }) };
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function createProduct(hostId: string, overrides: Record<string, unknown> = {}) {
  return prisma.product.create({
    data: {
      hostId,
      title: "测试拍品",
      category: "测试分类",
      imageUrl: "https://example.com/product.jpg",
      description: "测试描述",
      startPrice: 100,
      deposit: 0,
      minIncrement: 20,
      capPrice: 200,
      durationSec: 120,
      autoExtendSec: 15,
      status: "ACTIVE",
      ...overrides
    }
  });
}

export async function createLive(hostId: string, productIds: string[] = [], overrides: Record<string, unknown> = {}) {
  return prisma.liveSession.create({
    data: {
      hostId,
      title: "测试直播",
      roomId: `room-${randomUUID()}`,
      scheduledAt: new Date(Date.now() + 60_000),
      status: "SCHEDULED",
      currentProductId: productIds[0] ?? null,
      products: {
        create: productIds.map((productId, sortOrder) => ({ productId, sortOrder }))
      },
      ...overrides
    },
    include: { products: true }
  });
}

export async function createAuction(hostId: string, productId: string, liveSessionId?: string | null, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return prisma.auction.create({
    data: {
      hostId,
      productId,
      liveSessionId: liveSessionId ?? null,
      status: "RUNNING",
      startPrice: 100,
      currentPrice: 100,
      minIncrement: 20,
      capPrice: 200,
      autoExtendSec: 15,
      deposit: 0,
      startTime: now,
      endTime: new Date(now.getTime() + 120_000),
      ...overrides
    }
  });
}
