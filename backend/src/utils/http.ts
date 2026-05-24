import type { NextFunction, Request, Response } from "express";

export function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function toInt(value: unknown, fallback = NaN) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

export function toDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value ?? "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
