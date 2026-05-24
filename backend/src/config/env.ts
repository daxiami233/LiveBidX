import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 3000),
  merchantOrigin: process.env.MERCHANT_ORIGIN ?? process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  mobileOrigin: process.env.MOBILE_ORIGIN ?? "http://localhost:5174",
  authSecret: process.env.AUTH_SECRET ?? "livebidx-dev-secret",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
};
