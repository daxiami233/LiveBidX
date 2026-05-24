import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { verifyToken } from "../utils/token.js";

// 校验 Authorization Bearer token，并把当前用户挂到 res.locals.user。
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      res.status(401).json({ message: "未登录" });
      return;
    }

    const payload = verifyToken(token);

    if (!payload) {
      res.status(401).json({ message: "登录已失效" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, nickname: true, email: true, role: true, createdAt: true }
    });

    if (!user) {
      res.status(401).json({ message: "用户不存在" });
      return;
    }

    res.locals.user = user;
    next();
  } catch (error) {
    next(error);
  }
}
