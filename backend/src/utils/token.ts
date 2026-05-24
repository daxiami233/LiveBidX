import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

type TokenPayload = {
  userId: string;
  role: "CUSTOMER" | "HOST";
  exp: number;
};

// 将字符串编码为 URL 安全的 Base64。
function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

// 使用服务端密钥对 token 内容签名。
function sign(data: string) {
  return createHmac("sha256", env.authSecret).update(data).digest("base64url");
}

// 创建带过期时间的登录 token。
export function createToken(payload: Omit<TokenPayload, "exp">) {
  const body: TokenPayload = {
    ...payload,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  };
  const encoded = base64Url(JSON.stringify(body));

  return `${encoded}.${sign(encoded)}`;
}

// 校验 token 签名和过期时间，成功时返回载荷。
export function verifyToken(token: string): TokenPayload | null {
  const [encoded, signature] = token.split(".");

  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;

    if (!payload.userId || !payload.role || payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}
