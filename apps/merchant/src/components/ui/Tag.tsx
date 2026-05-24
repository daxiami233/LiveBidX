import type { ReactNode } from "react";

const statusClass: Record<string, string> = {
  竞拍中: "danger",
  讲解中: "info",
  待上架: "info",
  待审核: "warning",
  即将开拍: "info",
  已成交: "success",
  流拍: "muted",
  待开拍: "info",
  已取消: "muted",
  已下架: "muted",
  待支付: "warning",
  已支付: "success",
  已完成: "success",
  已退款: "muted",
  直播中: "danger",
  待开播: "info",
  已结束: "muted",
  正在拍卖: "danger",
  领先: "info",
  出价成功: "success",
  被超越: "muted"
};

export function Tag({ children }: { children: ReactNode }) {
  return <span className={`tag ${statusClass[String(children)] ?? "info"}`}>{children}</span>;
}
