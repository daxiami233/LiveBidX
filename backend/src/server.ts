import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { disconnectRedis } from "./config/redis.js";
import auctionRoutes from "./modules/auction/auction.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import liveRoutes from "./modules/live/live.routes.js";
import mobileRoutes from "./modules/mobile/mobile.routes.js";
import orderRoutes from "./modules/order/order.routes.js";
import productRoutes from "./modules/product/product.routes.js";
import { initializeRealtime } from "./realtime/auctionGateway.js";

const app = express();
const allowedOrigins = new Set([
  env.merchantOrigin,
  env.mobileOrigin,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174"
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("当前前端地址未被后端 CORS 允许"));
    },
    credentials: true
  })
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "LiveBidX API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/lives", liveRoutes);
app.use("/api/auctions", auctionRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/mobile", mobileRoutes);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  if (error instanceof Error && (error.name.startsWith("Prisma") || error.message.includes("prisma.") || error.message.includes("The table"))) {
    res.status(500).json({ message: "数据库结构未初始化或与当前服务不匹配，请执行 Prisma 迁移后重试" });
    return;
  }

  if (error instanceof Error && error.message) {
    res.status(400).json({ message: error.message });
    return;
  }

  res.status(500).json({ message: "服务器内部错误" });
});

const server = createServer(app);
await initializeRealtime(server);

server.listen(env.port, () => {
  console.log(`LiveBidX API running on http://localhost:${env.port}`);
});

// 优雅关闭数据库、Redis 和 HTTP 服务。
async function shutdown() {
  await prisma.$disconnect();
  await disconnectRedis();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
