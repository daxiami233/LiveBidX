import { Redis } from "ioredis";
import { env } from "./env.js";

let client: Redis | null = null;
let unavailableLogged = false;

// 获取 Redis 连接；连接不可用时返回 null，让业务降级到数据库流程。
export async function getRedis() {
  if (client?.status === "ready") return client;

  if (!client) {
    client = new Redis(env.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null
    });

    client.on("error", () => {
      if (!unavailableLogged) {
        unavailableLogged = true;
        console.warn("Redis unavailable, realtime cache falls back to PostgreSQL.");
      }
    });
  }

  try {
    if (client.status === "end" || client.status === "close") return null;
    if (client.status !== "ready") await client.connect();
    unavailableLogged = false;
    return client;
  } catch {
    return null;
  }
}

// 关闭 Redis 连接，用于服务退出时清理资源。
export async function disconnectRedis() {
  if (!client) return;
  client.disconnect();
}
