import type { NextFunction, Request, Response } from "express";

// 生成角色校验中间件，限制接口只能由指定角色访问。
export function requireRole(role: "CUSTOMER" | "HOST") {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (res.locals.user?.role !== role) {
      res.status(403).json({ message: "当前账号无权限执行该操作" });
      return;
    }

    next();
  };
}
