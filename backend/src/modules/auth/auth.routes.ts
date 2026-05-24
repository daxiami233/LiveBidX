import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { createToken } from "../../utils/token.js";

const router = Router();

// 包装异步路由，把异常交给 Express 统一错误处理中间件。
function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

// 去掉密码字段，只返回前端需要的安全用户信息。
function toSafeUser(user: { id: string; nickname: string; email: string; role: "CUSTOMER" | "HOST"; createdAt: Date }) {
  return {
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

// 注册新用户，并返回登录 token。
router.post("/register", asyncHandler(async (req, res) => {
  const { nickname, email, password, role } = req.body as {
    nickname?: string;
    email?: string;
    password?: string;
    role?: "CUSTOMER" | "HOST";
  };

  const nextRole = role ?? "HOST";

  if (!nickname?.trim() || !email?.trim() || !password || !["CUSTOMER", "HOST"].includes(nextRole)) {
    res.status(400).json({ message: "请填写完整注册信息" });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ message: "密码至少 6 位" });
    return;
  }

  const { hash, salt } = hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: {
        nickname: nickname.trim(),
        email: email.trim().toLowerCase(),
        passwordHash: hash,
        passwordSalt: salt,
        role: nextRole
      },
      select: { id: true, nickname: true, email: true, role: true, createdAt: true }
    });

    res.status(201).json({
      user: toSafeUser(user),
      token: createToken({ userId: user.id, role: user.role })
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      res.status(409).json({ message: "该邮箱已注册" });
      return;
    }

    throw error;
  }
}));

// 校验邮箱和密码，并返回登录 token。
router.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email?.trim() || !password) {
    res.status(400).json({ message: "请输入邮箱和密码" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() }
  });

  if (!user) {
    res.status(404).json({ message: "该邮箱未注册" });
    return;
  }

  if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
    res.status(401).json({ message: "密码错误" });
    return;
  }

  res.json({
    user: toSafeUser(user),
    token: createToken({ userId: user.id, role: user.role })
  });
}));

// 根据 token 返回当前登录用户。
router.get("/me", requireAuth, (_req, res) => {
  res.json({ user: res.locals.user });
});

export default router;
