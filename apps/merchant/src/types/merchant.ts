import type { LucideIcon } from "lucide-react";

export type ProductStatus = "竞拍中" | "讲解中" | "待开拍" | "已成交" | "流拍" | "已取消" | "已下架" | "待上架" | "待审核" | "即将开拍";
export type OrderStatus = "待支付" | "已支付" | "已完成" | "已取消" | "已退款";
export type PaymentStatus = "待支付" | "已支付" | "已退款";
export type LiveStatus = "直播中" | "待开播" | "已结束";
export type ModalName = "comment" | "queue" | "device" | "preview" | "logistics" | "ship" | "addProduct" | null;

export type Product = {
  id: string;
  title: string;
  category: string;
  image: string;
  description: string;
  startPrice: number;
  increment: number;
  capPrice: number;
  currentPrice: number;
  bidCount: number;
  duration: number;
  autoExtend: number;
  plannedTime: string;
  remaining: string;
  progress: number;
  status: ProductStatus;
  leader?: string;
  soldAt?: string;
  orderId?: string;
};

export type LiveSession = {
  id: string;
  title: string;
  status: LiveStatus;
  scheduledAt: string;
  startedAt?: string;
  endedAt?: string;
  durationText: string;
  host: string;
  roomId: string;
  onlineCount: number;
  productIds: string[];
  currentProductId?: string;
  activeAuctionProductId?: string;
  coverImage: string;
  tags: string[];
  networkStatus: "良好" | "一般" | "异常";
  streamStatus: "正常" | "未推流" | "异常";
};

export type BidRecord = {
  id: string;
  productId: string;
  user: string;
  amount: number;
  time: string;
  status: "领先" | "出价成功" | "被超越";
};

export type CommentRecord = {
  id: string;
  user: string;
  text: string;
  tone?: "normal" | "system";
};

export type Order = {
  id: string;
  productId: string;
  productTitle: string;
  productImage: string;
  buyer: string;
  phone: string;
  amount: number;
  liveSession: string;
  createdAt: string;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  countdown?: string;
};

export type Notice = {
  id: number;
  text: string;
  tone?: "success" | "warning" | "danger";
};

export type ConfirmState = {
  title: string;
  message: string;
  tone?: "primary" | "warning" | "danger";
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
};

export type ProductForm = {
  title: string;
  category: string;
  image: string;
  description: string;
  startPrice: string;
  increment: string;
  capPrice: string;
  duration: string;
  autoExtend: string;
  plannedTime: string;
  shipping: "" | "包邮" | "不包邮";
  stock: string;
  limit: string;
};

export type LiveForm = {
  title: string;
  scheduledAt: string;
  host: string;
  tags: string;
  roomId: string;
};

export type NavItem = {
  label: string;
  path: string;
  icon: LucideIcon;
};
