import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const iterations = 120000;
const keyLength = 64;
const digest = "sha512";

// 对明文密码生成带盐哈希，用于注册时存库。
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, keyLength, digest).toString("hex");

  return { hash, salt };
}

// 校验用户输入密码是否匹配数据库中的哈希。
export function verifyPassword(password: string, hash: string, salt: string) {
  const candidate = pbkdf2Sync(password, salt, iterations, keyLength, digest);
  const stored = Buffer.from(hash, "hex");

  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
