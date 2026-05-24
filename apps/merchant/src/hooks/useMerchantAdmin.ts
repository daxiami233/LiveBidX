import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addProductToLiveSession,
  cancelAuctionById,
  closeOrderById,
  createAuction,
  createLive as createLiveRequest,
  createProduct,
  deleteLiveById,
  deleteProductById,
  endAuctionById,
  endLiveById,
  extendAuctionById,
  fetchHostAuctions,
  fetchHostLives,
  fetchHostOrders,
  fetchHostProducts,
  reviewProductById,
  setCurrentLiveProduct,
  shipOrderById,
  startLiveById,
  updateLive,
  updateProduct,
  type BackendAuction,
  type BackendLiveSession,
  type BackendOrder,
  type BackendProduct
} from "../api/client";
import { createMerchantSocket } from "../api/realtime";
import type { BidRecord, CommentRecord, ConfirmState, LiveForm, LiveSession, ModalName, Notice, Order, PaymentStatus, Product, ProductForm, OrderStatus } from "../types/merchant";

const DEFAULT_PRODUCT_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'%3E%3Crect width='600' height='600' fill='%23eef3fa'/%3E%3Cpath d='M180 360l86-94 68 70 42-46 44 70H180z' fill='%23c4d0e0'/%3E%3Ccircle cx='390' cy='210' r='36' fill='%23d8e0ec'/%3E%3C/svg%3E";
const AUTH_TOKEN_KEY = "livebidx.auth.token";

type SocketCallback = (response: { ok: boolean; message?: string }) => void;

function formatDateTime(value?: string | null) {
  if (!value) return "待设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function secondsToClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return [hours, minutes, rest].map((item) => String(item).padStart(2, "0")).join(":");
}

function remainingText(auction?: BackendAuction) {
  if (!auction?.endTime || auction.status !== "RUNNING") return "-";
  return secondsToClock((new Date(auction.endTime).getTime() - Date.now()) / 1000);
}

function auctionProgress(auction?: BackendAuction) {
  if (!auction?.startTime || !auction.endTime || auction.status !== "RUNNING") return auction?.status === "ENDED" ? 100 : 0;
  const start = new Date(auction.startTime).getTime();
  const end = new Date(auction.endTime).getTime();
  if (end <= start) return 100;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
}

function liveStatus(status: BackendLiveSession["status"]): LiveSession["status"] {
  if (status === "LIVE") return "直播中";
  if (status === "ENDED") return "已结束";
  return "待开播";
}

function orderStatus(status: BackendOrder["status"]): OrderStatus {
  if (status === "PENDING_PAYMENT") return "待支付";
  if (status === "CANCELLED") return "已取消";
  if (status === "PAID") return "已支付";
  return "已完成";
}

function paymentStatus(status: BackendOrder["status"]): PaymentStatus {
  return status === "PAID" || status === "SHIPPED" || status === "COMPLETED" ? "已支付" : "待支付";
}

function latestAuctionFor(productId: string, auctions: BackendAuction[]) {
  return auctions
    .filter((auction) => auction.productId === productId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function runningAuctionFor(productId: string, auctions: BackendAuction[]) {
  return auctions.find((auction) => auction.productId === productId && auction.status === "RUNNING");
}

function hasEndedAuctionFor(productId: string, auctions: BackendAuction[]) {
  return auctions.some((auction) => auction.productId === productId && auction.status === "ENDED");
}

function toLiveSession(live: BackendLiveSession): LiveSession {
  const productIds = live.products?.map((item) => item.productId) ?? [];
  return {
    id: live.id,
    title: live.title,
    status: liveStatus(live.status),
    scheduledAt: formatDateTime(live.scheduledAt),
    startedAt: live.startedAt ? formatDateTime(live.startedAt) : undefined,
    endedAt: live.endedAt ? formatDateTime(live.endedAt) : undefined,
    durationText: live.startedAt && live.endedAt ? secondsToClock((new Date(live.endedAt).getTime() - new Date(live.startedAt).getTime()) / 1000) : "--:--:--",
    host: "当前主播",
    roomId: live.roomId,
    onlineCount: live.onlineCount,
    productIds,
    currentProductId: live.currentProductId ?? undefined,
    activeAuctionProductId: live.activeAuctionProductId ?? undefined,
    coverImage: live.coverImage ?? live.products?.[0]?.product.imageUrl ?? DEFAULT_PRODUCT_IMAGE,
    tags: live.tags,
    networkStatus: live.networkStatus === "异常" ? "异常" : live.networkStatus === "一般" ? "一般" : "良好",
    streamStatus: live.streamStatus === "异常" ? "异常" : live.streamStatus === "正常" ? "正常" : "未推流"
  };
}

function toProduct(product: BackendProduct, lives: BackendLiveSession[], auctions: BackendAuction[]): Product {
  const latestAuction = latestAuctionFor(product.id, auctions) ?? product.auctions?.[0];
  const runningAuction = runningAuctionFor(product.id, auctions);
  const liveExplaining = lives.some((live) => live.status === "LIVE" && live.currentProductId === product.id && live.activeAuctionProductId !== product.id);
  const activeOrScheduledLive = lives.find((live) => ["LIVE", "SCHEDULED"].includes(live.status) && live.products?.some((item) => item.productId === product.id));

  let status: Product["status"];
  if (runningAuction) status = "竞拍中";
  else if (latestAuction?.status === "ENDED" && latestAuction.order) status = "已成交";
  else if (latestAuction?.status === "ENDED") status = "流拍";
  else if (liveExplaining) status = "讲解中";
  else if (product.status === "REVIEWING") status = "待审核";
  else if (product.status === "ARCHIVED") status = "已下架";
  else if (activeOrScheduledLive) status = activeOrScheduledLive.status === "LIVE" ? "待开拍" : "即将开拍";
  else status = "待上架";

  const currentPrice = runningAuction?.currentPrice ?? latestAuction?.currentPrice ?? product.startPrice;

  return {
    id: product.id,
    title: product.title,
    category: product.category,
    image: product.imageUrl || DEFAULT_PRODUCT_IMAGE,
    description: product.description ?? "",
    startPrice: product.startPrice,
    increment: product.minIncrement,
    capPrice: product.capPrice ?? product.startPrice + product.minIncrement,
    currentPrice,
    bidCount: runningAuction?.bidCount ?? latestAuction?.bidCount ?? product.auctions?.[0]?.bidCount ?? 0,
    duration: Math.max(1, Math.round(product.durationSec / 60)),
    autoExtend: product.autoExtendSec,
    plannedTime: formatDateTime(product.plannedAt),
    remaining: runningAuction ? remainingText(runningAuction) : `${Math.max(1, Math.round(product.durationSec / 60))}分钟`,
    progress: auctionProgress(runningAuction ?? latestAuction),
    status,
    leader: runningAuction?.highestBidder?.nickname ?? latestAuction?.highestBidder?.nickname ?? undefined,
    soldAt: latestAuction?.order?.createdAt ? formatDateTime(latestAuction.order.createdAt) : undefined,
    orderId: latestAuction?.order?.id
  };
}

function toOrder(order: BackendOrder): Order {
  return {
    id: order.id,
    productId: order.productId,
    productTitle: order.product?.title ?? order.productId,
    productImage: order.product?.imageUrl ?? DEFAULT_PRODUCT_IMAGE,
    buyer: order.auction?.highestBidder?.nickname ?? order.buyerId,
    phone: "--",
    amount: order.amount,
    liveSession: order.auction?.liveSession?.title ?? order.auctionId,
    createdAt: formatDateTime(order.createdAt),
    paymentStatus: paymentStatus(order.status),
    status: orderStatus(order.status),
      countdown: order.status === "PENDING_PAYMENT" ? "待支付" : undefined
  };
}

function productPayload(form: ProductForm) {
  return {
    title: form.title.trim(),
    category: form.category.trim(),
    imageUrl: form.image.trim() || DEFAULT_PRODUCT_IMAGE,
    description: form.description.trim(),
    startPrice: Number(form.startPrice),
    minIncrement: Number(form.increment),
    capPrice: Number(form.capPrice),
    durationSec: Math.max(1, Number(form.duration)) * 60,
    autoExtendSec: Number(form.autoExtend || 15),
    plannedAt: form.plannedTime || undefined
  };
}

export function useMerchantAdmin() {
  const socketRef = useRef<ReturnType<typeof createMerchantSocket> | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<ReturnType<typeof toOrder>[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [auctions, setAuctions] = useState<BackendAuction[]>([]);
  const [bidRecords, setBidRecords] = useState<BidRecord[]>([]);
  const [comments, setComments] = useState<CommentRecord[]>([]);
  const [checkedPending, setCheckedPending] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<ModalName>(null);
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [modalOrderId, setModalOrderId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  function notify(text: string, tone: Notice["tone"] = "success") {
    setNotice({ id: Date.now(), text, tone });
  }

  const refreshData = useCallback(async () => {
    try {
      const [productData, liveData, orderData, auctionData] = await Promise.all([fetchHostProducts(), fetchHostLives(), fetchHostOrders(), fetchHostAuctions()]);
      const nextLives = liveData.lives.map(toLiveSession);
      const nextProducts = productData.products.map((product) => toProduct(product, liveData.lives, auctionData.auctions));
      const nextBidRecords = auctionData.auctions.flatMap((auction) =>
        (auction.bids ?? []).map((bid): BidRecord => ({
          id: bid.id,
          productId: auction.productId,
          user: bid.user?.nickname ?? bid.userId,
          amount: bid.amount,
          time: formatDateTime(bid.createdAt).slice(11),
          status: auction.highestBidderId === bid.userId ? "领先" : "被超越"
        }))
      );

      setAuctions(auctionData.auctions);
      setLiveSessions(nextLives);
      setProducts(nextProducts);
      setOrders(orderData.orders.map(toOrder));
      setBidRecords(nextBidRecords);
    } catch (error) {
      notify(error instanceof Error ? error.message : "加载数据库数据失败", "danger");
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  useEffect(() => {
    const disconnect = () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };

    const connect = () => {
      disconnect();
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) return;

      const socket = createMerchantSocket(token);
      socketRef.current = socket;
      socket.on("connect", () => {
        socket.emit("join_host_dashboard", {}, () => undefined);
      });
      socket.on("live_sessions", () => {
        refreshData();
      });
      socket.on("live_session_state", () => {
        refreshData();
      });
      socket.on("auction_state", () => {
        refreshData();
      });
      socket.on("auction_extended", () => {
        refreshData();
      });
      socket.on("bid_update", () => {
        refreshData();
      });
      socket.on("auction_ended", () => {
        refreshData();
      });
      socket.on("viewer_count_update", ({ liveSessionId, viewerCount }: { auctionId?: string; liveSessionId?: string; viewerCount: number }) => {
        if (!liveSessionId) return;
        setLiveSessions((current) => current.map((live) => live.id === liveSessionId ? { ...live, onlineCount: viewerCount } : live));
      });
      socket.on("chat_message", ({ message }: { message: { id: string; nickname: string; content: string; role?: string } }) => {
        setComments((current) => current.some((item) => item.id === message.id) ? current : [
          { id: message.id, user: message.role === "HOST" ? "主播" : message.nickname, text: message.content },
          ...current
        ].slice(0, 80));
      });
      socket.on("chat_history", ({ messages }: { messages: Array<{ id: string; nickname: string; content: string; role?: string }> }) => {
        setComments(messages.map((message) => ({
          id: message.id,
          user: message.role === "HOST" ? "主播" : message.nickname,
          text: message.content
        })).reverse());
      });
      socket.on("connect_error", (error) => {
        notify(error.message || "实时连接失败", "warning");
      });
      socket.connect();
    };

    connect();
    window.addEventListener("livebidx-auth-changed", connect);

    return () => {
      window.removeEventListener("livebidx-auth-changed", connect);
      disconnect();
    };
  }, [refreshData]);

  const activeLive = useMemo(() => liveSessions.find((item) => item.status === "直播中") ?? null, [liveSessions]);
  const currentLive = activeLive ?? liveSessions.find((item) => item.status === "待开播") ?? liveSessions[0] ?? null;
  const activeAuctionProduct = useMemo(() => {
    if (!activeLive?.activeAuctionProductId) return null;
    return products.find((item) => item.id === activeLive.activeAuctionProductId) ?? null;
  }, [activeLive, products]);
  const currentExplainProduct = useMemo(() => {
    if (!activeLive?.currentProductId) return null;
    return products.find((item) => item.id === activeLive.currentProductId) ?? null;
  }, [activeLive, products]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !activeLive?.id) return;
    socket.emit("join_live_session", { liveSessionId: activeLive.id }, () => undefined);
    return () => {
      socket.emit("leave_live_session", { liveSessionId: activeLive.id });
    };
  }, [activeLive?.id]);

  useEffect(() => {
    const socket = socketRef.current;
    const auctionId = activeAuctionProduct ? runningAuctionId(activeAuctionProduct.id) : null;
    if (!socket || !auctionId) return;
    socket.emit("join_auction", { auctionId }, () => undefined);
    return () => {
      socket.emit("leave_auction", { auctionId });
    };
  }, [activeAuctionProduct?.id, auctions]);

  function requestConfirm(confirm: ConfirmState) {
    setConfirmState(confirm);
  }

  function closeConfirm() {
    setConfirmState(null);
  }

  function runConfirmed() {
    const action = confirmState?.onConfirm;
    setConfirmState(null);
    action?.();
  }

  function openModal(name: ModalName, product?: Product, orderId?: string) {
    setModal(name);
    setModalProduct(product ?? null);
    setModalOrderId(orderId ?? null);
  }

  function closeModal() {
    setModal(null);
    setModalProduct(null);
    setModalOrderId(null);
  }

  function createLive() {
    return currentLive?.id;
  }

  async function saveLive(id: string | undefined, form: LiveForm, productIds: string[] = []) {
    const title = form.title.trim();
    if (!title || !form.scheduledAt.trim()) {
      notify("请填写直播标题和计划开播时间", "warning");
      return false;
    }

    try {
      const payload = {
        title,
        scheduledAt: form.scheduledAt,
        tags: form.tags,
        roomId: form.roomId.trim() || undefined,
        productIds
      };
      if (id) await updateLive(id, payload);
      else await createLiveRequest(payload);
      await refreshData();
      notify(id ? "直播信息已保存" : "直播已创建，拍品队列已绑定");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存直播失败", "danger");
      return false;
    }
  }

  function deleteLive(id: string) {
    const live = liveSessions.find((item) => item.id === id);
    if (!live) return;
    if (live.status === "直播中") {
      notify("直播中场次不能删除，请先结束直播", "danger");
      return;
    }

    requestConfirm({
      title: "删除直播",
      message: `确认删除「${live.title}」吗？删除后该场次不会再出现在直播管理列表中。`,
      tone: "danger",
      confirmText: "确认删除",
      onConfirm: async () => {
        try {
          await deleteLiveById(id);
          await refreshData();
          notify("直播已删除", "warning");
        } catch (error) {
          notify(error instanceof Error ? error.message : "删除直播失败", "danger");
        }
      }
    });
  }

  function startLive(liveId?: string) {
    const targetLive = liveSessions.find((item) => item.id === liveId) ?? currentLive;
    if (!targetLive) return false;

    requestConfirm({
      title: "开始直播",
      message: "开始后将显示直播画面、拍品队列、评论区和实时出价。离开控制台不会结束直播。",
      confirmText: "开始直播",
      onConfirm: async () => {
        try {
          await startLiveById(targetLive.id);
          await refreshData();
          notify("直播已开始，控制台已进入实时模式");
        } catch (error) {
          notify(error instanceof Error ? error.message : "开始直播失败", "danger");
        }
      }
    });
    return true;
  }

  function endLive(liveId?: string) {
    const live = liveSessions.find((item) => item.id === liveId) ?? activeLive;
    if (!live || live.status !== "直播中") {
      notify("当前没有正在进行的直播", "warning");
      return false;
    }

    requestConfirm({
      title: "结束直播",
      message: "结束后直播画面、评论和出价会停止，场次进入已结束。",
      tone: "danger",
      confirmText: "确认结束",
      onConfirm: async () => {
        try {
          await endLiveById(live.id);
          await refreshData();
          notify("直播已结束，当前场次已进入数据复盘");
        } catch (error) {
          notify(error instanceof Error ? error.message : "结束直播失败", "danger");
        }
      }
    });
    return true;
  }

  function selectProductForLive(id: string) {
    if (!activeLive) {
      notify("请先开始直播，再选择当前讲解商品", "warning");
      return false;
    }
    if (activeLive.activeAuctionProductId) {
      notify("当前已有拍品正在竞拍，请先结束本轮", "warning");
      return false;
    }
    if (hasEndedAuctionFor(id, auctions)) {
      notify("已结束的拍品不能重新设为当前拍品", "warning");
      return false;
    }

    setCurrentLiveProduct(activeLive.id, id)
      .then(refreshData)
      .then(() => notify("已切换为当前讲解商品"))
      .catch((error) => notify(error instanceof Error ? error.message : "切换讲解商品失败", "danger"));
    return true;
  }

  function startAuction(id: string) {
    if (!activeLive) {
      notify("请先开始直播，再开始竞拍", "warning");
      return false;
    }
    if (activeLive.activeAuctionProductId) {
      notify("当前已有拍品正在竞拍，请先结束本轮", "warning");
      return false;
    }
    if (activeLive.currentProductId !== id) {
      notify("只能开始当前拍品的竞拍，请先从队列切换当前拍品", "warning");
      return false;
    }
    if (hasEndedAuctionFor(id, auctions)) {
      notify("已结束的拍品不能重复开拍", "warning");
      return false;
    }

    createAuction(id, activeLive.id, (products.find((item) => item.id === id)?.duration ?? 5) * 60)
      .then(refreshData)
      .then(() => notify("竞拍已开始，直播间已广播当前拍品"))
      .catch((error) => notify(error instanceof Error ? error.message : "开始竞拍失败", "danger"));
    return true;
  }

  function explainProduct(id: string) {
    return selectProductForLive(id);
  }

  function deleteProduct(id: string) {
    const product = products.find((item) => item.id === id);
    if (!product) return;
    requestConfirm({
      title: "删除商品",
      message: "确认删除该商品吗？已有竞拍记录的商品会由后端保留历史数据。",
      tone: "danger",
      confirmText: "删除",
      onConfirm: async () => {
        try {
          await deleteProductById(id);
          await refreshData();
          notify("商品已删除或下架", "warning");
        } catch (error) {
          notify(error instanceof Error ? error.message : "删除商品失败", "danger");
        }
      }
    });
  }

  function reviewProduct(id: string, approved: boolean) {
    reviewProductById(id, approved)
      .then(refreshData)
      .then(() => notify(approved ? "审核通过，商品已进入待上架状态" : "已驳回商品审核", approved ? "success" : "warning"))
      .catch((error) => notify(error instanceof Error ? error.message : "审核商品失败", "danger"));
  }

  async function saveProduct(form: ProductForm, productId?: string) {
    const startPrice = Number(form.startPrice);
    const increment = Number(form.increment);
    const capPrice = Number(form.capPrice);
    const duration = Number(form.duration);
    const autoExtend = Number(form.autoExtend);
    const stock = Number(form.stock);

    if (!form.title.trim()) return notify("商品标题不能为空", "danger"), false;
    if (!form.category) return notify("商品类目不能为空", "danger"), false;
    if (!form.image) return notify("商品主图不能为空", "danger"), false;
    if (Number.isNaN(startPrice) || startPrice <= 0) return notify("起拍价必须大于 0", "danger"), false;
    if (Number.isNaN(increment) || increment <= 0) return notify("加价幅度必须大于 0", "danger"), false;
    if (Number.isNaN(capPrice) || capPrice <= startPrice) return notify("封顶价必须大于起拍价", "danger"), false;
    if (Number.isNaN(duration) || duration <= 0) return notify("竞拍时长必须大于 0", "danger"), false;
    if (![10, 20, 30].includes(autoExtend)) return notify("自动延时只能选择 10 / 20 / 30 秒", "danger"), false;
    if (Number.isNaN(stock) || stock < 0) return notify("库存数量不合法", "danger"), false;

    try {
      if (productId) await updateProduct(productId, productPayload(form));
      else await createProduct(productPayload(form));
      await refreshData();
      notify("商品已保存");
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存商品失败", "danger");
      return false;
    }
  }

  function runningAuctionId(productId: string) {
    return auctions.find((auction) => auction.productId === productId && auction.status === "RUNNING")?.id;
  }

  function cancelAuction(id: string) {
    const auctionId = runningAuctionId(id);
    if (!auctionId) return notify("只有正在竞拍的商品可以取消竞拍", "warning");
    requestConfirm({
      title: "取消竞拍",
      message: "取消后当前出价不会生成订单，直播间会同步广播取消原因。",
      tone: "danger",
      confirmText: "确认取消",
      onConfirm: async () => {
        try {
          await cancelAuctionById(auctionId);
          await refreshData();
          notify("竞拍已取消，直播间已广播", "danger");
        } catch (error) {
          notify(error instanceof Error ? error.message : "取消竞拍失败", "danger");
        }
      }
    });
  }

  function extendAuction(id: string, seconds: number) {
    const auctionId = runningAuctionId(id);
    if (!auctionId) return notify("只有当前正在拍卖的商品可以延长时间", "warning");
    extendAuctionById(auctionId, seconds)
      .then(refreshData)
      .then(() => notify(`已延长 ${seconds} 秒，倒计时已更新`))
      .catch((error) => notify(error instanceof Error ? error.message : "延长竞拍失败", "danger"));
  }

  function finishAuction(id: string) {
    const auctionId = runningAuctionId(id);
    if (!auctionId) return notify("只有正在竞拍的商品可以结束本轮", "warning");
    requestConfirm({
      title: "结束本轮竞拍",
      message: "系统将按当前最高出价生成订单；若暂无出价则本轮不会生成订单。",
      confirmText: "结束本轮",
      onConfirm: async () => {
        try {
          await endAuctionById(auctionId);
          await refreshData();
          notify("本轮竞拍已结束");
        } catch (error) {
          notify(error instanceof Error ? error.message : "结束竞拍失败", "danger");
        }
      }
    });
  }

  function closeOrder(id: string) {
    requestConfirm({
      title: "关闭订单",
      message: "确认关闭该订单吗？关闭后买家将无法继续支付。",
      tone: "danger",
      confirmText: "关闭订单",
      onConfirm: async () => {
        try {
          await closeOrderById(id);
          await refreshData();
          notify("订单已关闭", "warning");
        } catch (error) {
          notify(error instanceof Error ? error.message : "关闭订单失败", "danger");
        }
      }
    });
  }

  function shipOrder(id: string, payload: { company: string; trackingNo: string }) {
    shipOrderById(id, payload)
      .then(refreshData)
      .then(() => notify("发货信息已提交，订单状态已更新"))
      .catch((error) => notify(error instanceof Error ? error.message : "订单发货失败", "danger"));
  }

  function addProductToLive(productId: string, liveId?: string) {
    const live = liveSessions.find((item) => item.id === liveId) ?? currentLive;
    if (!live) return;
    addProductToLiveSession(live.id, productId)
      .then(refreshData)
      .then(() => notify("商品已加入当前直播拍品队列"))
      .catch((error) => notify(error instanceof Error ? error.message : "添加拍品失败", "danger"));
  }

  function shelfProduct() {
    notify("当前已接入数据库，请通过创建直播并添加拍品完成上架", "warning");
  }

  function batchShelf() {
    notify("当前已接入数据库，请在直播编辑页逐个添加拍品", "warning");
  }

  function unshelfProduct(id: string) {
    deleteProduct(id);
  }

  function sendComment(text: string) {
    const value = text.trim();
    if (!value) {
      notify("评论内容不能为空", "warning");
      return false;
    }

    const auctionId = activeAuctionProduct ? runningAuctionId(activeAuctionProduct.id) : null;
    const liveSessionId = activeLive?.id;
    const socket = socketRef.current;
    if (!socket || !liveSessionId) {
      notify("当前没有正在直播的场次，无法发送评论", "warning");
      return false;
    }

    socket.emit("send_chat", { liveSessionId, auctionId: auctionId ?? undefined, content: value }, ((response) => {
      if (!response.ok) {
        notify(response.message ?? "评论发送失败", "danger");
      }
    }) as SocketCallback);
    return true;
  }

  return {
    products,
    orders,
    liveSessions,
    activeLive,
    currentLive,
    activeAuctionProduct,
    currentExplainProduct,
    bidRecords,
    comments,
    checkedPending,
    setCheckedPending,
    notice,
    setNotice,
    modal,
    modalProduct,
    modalOrderId,
    confirmState,
    notify,
    openModal,
    closeModal,
    requestConfirm,
    closeConfirm,
    runConfirmed,
    shelfProduct,
    batchShelf,
    createLive,
    saveLive,
    deleteLive,
    startLive,
    endLive,
    selectProductForLive,
    startAuction,
    explainProduct,
    deleteProduct,
    reviewProduct,
    saveProduct,
    cancelAuction,
    extendAuction,
    finishAuction,
    closeOrder,
    shipOrder,
    addProductToLive,
    unshelfProduct,
    sendComment
  };
}
