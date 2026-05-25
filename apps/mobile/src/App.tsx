import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  CreditCard,
  Eye,
  EyeOff,
  Gavel,
  Heart,
  ListOrdered,
  MapPin,
  MessageCircle,
  PackageCheck,
  Radio,
  Send,
  Settings,
  ShoppingBag,
  Trophy,
  Truck,
  User,
  Wallet,
  X
} from "lucide-react";
import {
  cancelMobileOrder,
  completeMobileOrder,
  createAddress,
  fetchAddresses,
  fetchBidHistory,
  fetchCurrentUser,
  fetchMobileLiveRoom,
  fetchMobileLiveRooms,
  fetchMobileOrder,
  fetchMobileOrders,
  login,
  payMobileOrder,
  register,
  setDefaultAddress as setDefaultAddressApi,
  updateAddress,
  updateMobileOrderAddress,
  type Address,
  type AuthResponse,
  type AuthUser,
  type BidHistoryItem,
  type MobileLiveRoom,
  type MobileOrder,
  type MobileProduct,
  type RankingRow
} from "./api/client";
import { createMobileSocket } from "./api/realtime";

type Panel = "detail" | "ranking" | "queue" | "bid" | "success" | "lost" | null;
type RouteState = { from?: string };
type LiveComment = { id: string; user: string; text: string };
type SocketInstance = ReturnType<typeof createMobileSocket>;
type PreviewProductItem = { type: "current" | "next"; product: MobileProduct | null };
type RealtimeAuction = {
  id: string;
  productId: string;
  currentPrice: number;
  minIncrement: number;
  capPrice?: number | null;
  endTime?: string | null;
  status: "PENDING" | "RUNNING" | "ENDED" | "CANCELLED";
  highestBidderId?: string | null;
  highestBidder?: { id: string; nickname: string } | null;
  product?: {
    id: string;
    title: string;
    imageUrl?: string | null;
    description?: string | null;
    startPrice: number;
    minIncrement: number;
    capPrice?: number | null;
    autoExtendSec?: number;
  };
  bids?: Array<{ id: string; userId: string; amount: number; createdAt: string; user?: { id: string; nickname: string } }>;
  bidCount?: number;
  order?: { id: string } | null;
};
type LiveAuctionPayload = { auction: RealtimeAuction };
type LiveSessionStatePayload = { live?: { id: string; status: "SCHEDULED" | "LIVE" | "ENDED" } };
type LiveEndedPayload = { liveSessionId: string };
type ChatPayload = { message: { id: string; nickname: string; content: string } };
type ChatHistoryPayload = { messages: Array<{ id: string; nickname: string; content: string }> };
type ViewerCountPayload = { auctionId?: string; liveSessionId?: string; viewerCount: number };
const MOBILE_AUTH_TOKEN_KEY = "livebidx.mobile.auth.token";
const MOBILE_AUTH_USER_KEY = "livebidx.mobile.auth.user";

const tabs = [
  { to: "/mobile/live-hall", label: "直播", icon: Radio },
  { to: "/mobile/mine", label: "我的", icon: User }
];

function money(value: number) {
  return `¥${value}`;
}

function countdownText(endTime?: string | null) {
  if (!endTime) return "竞拍中";
  const remaining = Math.max(0, new Date(endTime).getTime() - Date.now());
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `00:${minutes}:${seconds}`;
}

function toneFromId(id: string) {
  const tones = ["ivory", "mint", "jade", "violet"];
  return tones[Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tones.length];
}

function mergeAuctionIntoRoom(room: MobileLiveRoom, auction: RealtimeAuction, viewerCount?: number): MobileLiveRoom {
  const product = room.currentProduct?.id === auction.productId
    ? room.currentProduct
    : {
        id: auction.product?.id ?? auction.productId,
        name: auction.product?.title ?? room.currentProduct?.name ?? "当前拍品",
        lotNo: `Lot.${auction.productId.slice(-8)}`,
        imageUrl: auction.product?.imageUrl ?? undefined,
        description: auction.product?.description ?? undefined,
        imageTone: toneFromId(auction.productId),
        startPrice: auction.product?.startPrice ?? auction.currentPrice,
        currentPrice: auction.currentPrice,
        nextPrice: auction.currentPrice + auction.minIncrement,
        increment: auction.minIncrement,
        capPrice: auction.capPrice ?? auction.currentPrice + auction.minIncrement,
        countdown: countdownText(auction.endTime),
        leader: auction.highestBidder?.nickname ?? "-"
      };

  return {
    ...room,
    viewers: typeof viewerCount === "number" ? String(viewerCount) : room.viewers,
    currentProduct: {
      ...product,
      currentPrice: auction.currentPrice,
      nextPrice: auction.currentPrice + auction.minIncrement,
      increment: auction.minIncrement,
      capPrice: auction.capPrice ?? product.capPrice,
      countdown: countdownText(auction.endTime),
      leader: auction.highestBidder?.nickname ?? "-"
    },
    auctionId: auction.id
  };
}

function rankingFromAuction(auction: RealtimeAuction, myUserId?: string): RankingRow[] {
  const bestByUser = new Map<string, RankingRow>();
  for (const bid of auction.bids ?? []) {
    const existing = bestByUser.get(bid.userId);
    if (existing && existing.price >= bid.amount) continue;
    bestByUser.set(bid.userId, {
      rank: 0,
      user: bid.user?.nickname ?? bid.userId,
      price: bid.amount,
      count: (auction.bids ?? []).filter((item) => item.userId === bid.userId).length,
      status: auction.highestBidderId === bid.userId ? "领先中" : "已被超越",
      mine: bid.userId === myUserId
    });
  }

  return [...bestByUser.values()]
    .sort((a, b) => b.price - a.price)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function routeSource(location: ReturnType<typeof useLocation>) {
  return `${location.pathname}${location.search}`;
}

function getSavedMobileUser() {
  const saved = localStorage.getItem(MOBILE_AUTH_USER_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as AuthUser;
  } catch {
    localStorage.removeItem(MOBILE_AUTH_USER_KEY);
    return null;
  }
}

function getMobileToken() {
  return localStorage.getItem(MOBILE_AUTH_TOKEN_KEY) ?? "";
}

function ProductArt({ tone, label, imageUrl }: { tone: string; label?: string; imageUrl?: string }) {
  if (imageUrl) {
    return (
      <div className={`product-art tone-${tone}`}>
        <img src={imageUrl} alt={label ?? "商品图片"} />
      </div>
    );
  }

  return (
    <div className={`product-art tone-${tone}`}>
      <span>{label ?? "商品"}</span>
    </div>
  );
}

function MobileTabLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <main className="mobile-shell tab-shell">
      {children}
      <nav className="mobile-tabs" aria-label="手机端导航">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = location.pathname === tab.to;
          return (
            <Link className={active ? "active" : ""} key={tab.to} to={tab.to}>
              <Icon size={20} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </main>
  );
}

function LiveHallPage() {
  const location = useLocation();
  const [rooms, setRooms] = useState<MobileLiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [remindedRooms, setRemindedRooms] = useState<string[]>([]);
  const liveNow = rooms.filter((room) => room.status === "live");
  const upcoming = rooms.filter((room) => room.status === "upcoming");

  useEffect(() => {
    fetchMobileLiveRooms(getMobileToken())
      .then(({ rooms }) => setRooms(rooms))
      .catch(() => setRooms([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const socket = createMobileSocket(getMobileToken());
    socket.on("live_auctions", () => {
      fetchMobileLiveRooms(getMobileToken())
        .then(({ rooms }) => setRooms(rooms))
        .catch(() => undefined);
    });
    socket.on("viewer_count_update", ({ liveSessionId, viewerCount }: ViewerCountPayload) => {
      if (!liveSessionId) return;
      setRooms((current) => current.map((room) => room.id === liveSessionId ? { ...room, viewers: String(viewerCount) } : room));
    });
    socket.connect();
    socket.emit("join_lobby", {}, () => undefined);

    return () => {
      socket.emit("leave_lobby");
      socket.disconnect();
    };
  }, []);

  return (
    <MobileTabLayout>
      <header className="hall-hero">
        <p>实时竞拍大师</p>
        <h1>直播大厅</h1>
        <span>发现正在热拍的珠宝好物</span>
      </header>

      <section className="section-block">
        <div className="section-heading">
          <h2>正在直播</h2>
          <span>{liveNow.length} 场开拍</span>
        </div>
        <div className="live-card-list">
          {loading && <div className="empty-block table-empty">正在加载直播间...</div>}
          {!loading && liveNow.length === 0 && <div className="empty-block table-empty">暂无正在直播的场次</div>}
          {liveNow.map((room) => (
            <Link className="live-card" key={room.id} to={`/mobile/live/${room.id}`} state={{ from: routeSource(location) }}>
              <div className={`live-cover cover-${room.coverTone}`}>
                <span className="live-badge">直播中</span>
                {room.currentProduct ? <ProductArt tone={room.currentProduct.imageTone} imageUrl={room.currentProduct.imageUrl} label={room.currentProduct.name} /> : <div className="empty-product-art">无</div>}
              </div>
              <div className="live-card-body">
                <h3>{room.title}</h3>
                <p>{room.merchant}</p>
                <div className="live-meta">
                  <span>
                    <Heart size={14} />
                    {room.heatRank}
                  </span>
                  <span>
                    <User size={14} />
                    {room.viewers}
                  </span>
                </div>
                <strong>{room.currentProduct?.name ?? "暂无当前拍品"}</strong>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>热门直播间</h2>
          <span>高互动</span>
        </div>
        <div className="hot-room">
          <div>
            <strong>{liveNow[0]?.title ?? "暂无热门直播间"}</strong>
            <p>{liveNow[0] ? liveNow[0].currentProduct ? `本场已拍 ${liveNow[0].soldCount} 件，当前最高价 ${money(liveNow[0].currentProduct.currentPrice)}` : `本场已拍 ${liveNow[0].soldCount} 件，暂无当前拍品` : "开播后将在这里展示热门场次"}</p>
          </div>
          {liveNow[0] && <Link to={`/mobile/live/${liveNow[0].id}`} state={{ from: routeSource(location) }}>进入</Link>}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>即将开播</h2>
          <span>预约提醒</span>
        </div>
        {!loading && upcoming.length === 0 && <div className="empty-block table-empty">暂无预约直播</div>}
        {upcoming.map((room) => (
          <article className="upcoming-row" key={room.id}>
            {room.currentProduct ? <ProductArt tone={room.currentProduct.imageTone} imageUrl={room.currentProduct.imageUrl} label={room.currentProduct.name} /> : <div className="empty-product-art">无</div>}
            <div>
              <h3>{room.title}</h3>
              <p>{room.startsAt} · {room.currentProduct?.name ?? "暂无拍品"}</p>
            </div>
            <button type="button" onClick={() => setRemindedRooms((current) => current.includes(room.id) ? current : [...current, room.id])}>
              <Bell size={16} />
              {remindedRooms.includes(room.id) ? "已提醒" : "提醒"}
            </button>
          </article>
        ))}
      </section>
    </MobileTabLayout>
  );
}

function MinePage({ user }: { user: AuthUser | null }) {
  const location = useLocation();
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [bidItems, setBidItems] = useState<BidHistoryItem[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);

    Promise.allSettled([
      fetchMobileOrders(getMobileToken()),
      fetchBidHistory(getMobileToken()),
      fetchAddresses(getMobileToken())
    ])
      .then(([ordersResult, bidHistoryResult, addressesResult]) => {
        if (!alive) return;
        setOrders(ordersResult.status === "fulfilled" ? ordersResult.value.orders : []);
        setBidItems(bidHistoryResult.status === "fulfilled" ? bidHistoryResult.value.items : []);
        setAddresses(addressesResult.status === "fulfilled" ? addressesResult.value.addresses : []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const pendingPaymentCount = orders.filter((order) => order.status === "待支付").length;
  const runningBidCount = bidItems.filter((item) => item.status === "竞拍中").length;
  const wonCount = bidItems.filter((item) => item.status === "已拍中").length;
  const totalBidCount = bidItems.reduce((total, item) => total + item.bidCount, 0);
  const displayName = user?.nickname?.trim() || user?.email?.split("@")[0] || "用户";
  const accountText = user?.email ? `用户账号 · ${user.email}` : "当前登录账号";
  const profileStatus = user?.email ? "已登录" : "未登录";
  const countText = (value: number, suffix = "") => loading ? "..." : `${value}${suffix}`;
  const entries = [
    { to: "/mobile/orders?tab=待支付", icon: PackageCheck, label: "我的订单", value: loading ? "加载中" : `待支付 ${pendingPaymentCount} 笔` },
    { to: "/mobile/bid-history?tab=竞拍中", icon: Gavel, label: "我的竞拍记录", value: loading ? "加载中" : `竞拍中 ${runningBidCount} 条` },
    { to: "/mobile/addresses", icon: MapPin, label: "收货地址", value: loading ? "加载中" : `${addresses.length} 个地址` },
    { to: "/mobile/settings", icon: Settings, label: "客服 / 设置", value: profileStatus }
  ];

  return (
    <MobileTabLayout>
      <section className="mine-header">
        <div className="mine-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
        <div>
          <h1>{displayName}</h1>
          <p>{accountText}</p>
        </div>
      </section>

      <section className="mine-stats">
        <Link to="/mobile/bid-history?tab=全部" state={{ from: routeSource(location) }}>
          <strong>{countText(totalBidCount)}</strong>
          <span>出价次数</span>
        </Link>
        <Link to="/mobile/bid-history?tab=已拍中" state={{ from: routeSource(location) }}>
          <strong>{countText(wonCount)}</strong>
          <span>拍中商品</span>
        </Link>
        <Link to="/mobile/orders?tab=待支付" state={{ from: routeSource(location) }}>
          <strong>{countText(pendingPaymentCount)}</strong>
          <span>待支付</span>
        </Link>
      </section>

      <section className="mine-menu">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link key={entry.label} to={entry.to} state={{ from: routeSource(location) }}>
              <Icon size={20} />
              <span>{entry.label}</span>
              <em>{entry.value}</em>
              <ChevronRight size={18} />
            </Link>
          );
        })}
      </section>
    </MobileTabLayout>
  );
}

function LiveRoomPage() {
  const { liveId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const source = (location.state as RouteState | null)?.from ?? "/mobile/live-hall";
  const currentUserId = getSavedMobileUser()?.id;
  const [room, setRoom] = useState<MobileLiveRoom | null>(null);
  const [queue, setQueue] = useState<MobileProduct[]>([]);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [expandedProduct, setExpandedProduct] = useState(false);
  const [commentSent, setCommentSent] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [auctionId, setAuctionId] = useState<string | null>(null);
  const [roomTip, setRoomTip] = useState<string | null>(null);
  const [liveEnded, setLiveEnded] = useState(false);
  const commentsRef = useRef<HTMLDivElement | null>(null);
  const scrollIdleTimer = useRef<number | null>(null);
  const liveEndedTimer = useRef<number | null>(null);
  const socketRef = useRef<SocketInstance | null>(null);
  const auctionIdRef = useRef<string | null>(null);
  const product = room?.currentProduct;
  const previewProducts = useMemo<PreviewProductItem[]>(() => {
    if (!product) {
      return [
        { type: "current", product: null },
        { type: "next", product: queue[0] ?? null }
      ];
    }
    const currentIndex = queue.findIndex((item) => item.id === product.id);
    const nextProduct = queue.find((item, index) => index > currentIndex && item.id !== product.id)
      ?? queue.find((item) => item.id !== product.id)
      ?? null;

    return [
      { type: "current", product },
      { type: "next", product: nextProduct }
    ];
  }, [product, queue]);

  const showRoomTip = (message: string, delay = 1400) => {
    setRoomTip(message);
    window.setTimeout(() => setRoomTip(null), delay);
  };

  const exitLiveRoom = () => {
    if (liveEndedTimer.current) {
      window.clearTimeout(liveEndedTimer.current);
      liveEndedTimer.current = null;
    }
    if (liveId) socketRef.current?.emit("leave_live_session", { liveSessionId: liveId });
    if (auctionIdRef.current) socketRef.current?.emit("leave_auction", { auctionId: auctionIdRef.current });
    navigate(source, { replace: true });
  };

  const showLiveEndedDialog = () => {
    setPanel(null);
    setRoomTip(null);
    setLiveEnded(true);
    if (liveEndedTimer.current) window.clearTimeout(liveEndedTimer.current);
    liveEndedTimer.current = window.setTimeout(exitLiveRoom, 2600);
  };

  useEffect(() => {
    auctionIdRef.current = auctionId;
  }, [auctionId]);

  useEffect(() => {
    if (!liveId) return;
    setLiveEnded(false);
    if (liveEndedTimer.current) {
      window.clearTimeout(liveEndedTimer.current);
      liveEndedTimer.current = null;
    }
    fetchMobileLiveRoom(liveId, getMobileToken())
      .then(({ room, queue, ranking, auction }) => {
        setRoom(room);
        setQueue(queue);
        setRanking(ranking);
        setAuctionId(auction?.id ?? room.auctionId ?? null);
      })
      .catch(() => {
        setRoom(null);
        setQueue([]);
        setRanking([]);
      });
  }, [liveId]);

  useEffect(() => {
    if (!liveId) return;
    const socket = createMobileSocket(getMobileToken());
    socketRef.current = socket;

    const refreshRoom = () => {
      fetchMobileLiveRoom(liveId, getMobileToken())
        .then(({ room, queue, ranking, auction }) => {
          setRoom(room);
          setQueue(queue);
          setRanking(ranking);
          setAuctionId(auction?.id ?? room.auctionId ?? null);
        })
        .catch(() => undefined);
    };

    socket.on("connect", () => {
      socket.emit("join_live_session", { liveSessionId: liveId }, () => undefined);
      if (auctionIdRef.current) socket.emit("join_auction", { auctionId: auctionIdRef.current }, () => undefined);
    });
    socket.on("live_session_state", ({ live }: LiveSessionStatePayload) => {
      if (live?.status === "ENDED") {
        showLiveEndedDialog();
        return;
      }
      refreshRoom();
    });
    socket.on("live_ended", ({ liveSessionId: endedLiveId }: LiveEndedPayload) => {
      if (endedLiveId === liveId) showLiveEndedDialog();
    });
    socket.on("auction_state", ({ auction }: LiveAuctionPayload) => {
      setAuctionId(auction.id);
      setRoom((current) => current ? mergeAuctionIntoRoom(current, auction) : current);
      setRanking(rankingFromAuction(auction));
    });
    socket.on("auction_extended", ({ auction }: LiveAuctionPayload) => {
      setRoom((current) => current ? mergeAuctionIntoRoom(current, auction) : current);
    });
    socket.on("bid_update", ({ auction }: LiveAuctionPayload) => {
      setAuctionId(auction.id);
      setRoom((current) => current ? mergeAuctionIntoRoom(current, auction) : current);
      setRanking(rankingFromAuction(auction));
    });
    socket.on("auction_ended", ({ auction }: LiveAuctionPayload) => {
      setRoom((current) => current ? mergeAuctionIntoRoom(current, auction) : current);
      setPanel(auction.highestBidderId && auction.highestBidderId === currentUserId ? "success" : "lost");
      refreshRoom();
    });
    socket.on("viewer_count_update", ({ auctionId: eventAuctionId, liveSessionId, viewerCount }: ViewerCountPayload) => {
      const currentAuctionId = auctionIdRef.current;
      setRoom((current) => current && (liveSessionId === liveId || !eventAuctionId || eventAuctionId === currentAuctionId) ? { ...current, viewers: String(viewerCount) } : current);
    });
    socket.on("chat_history", ({ messages }: ChatHistoryPayload) => {
      setComments(messages.map((message) => ({ id: message.id, user: message.nickname, text: message.content })));
    });
    socket.on("chat_message", ({ message }: ChatPayload) => {
      setComments((current) => current.some((item) => item.id === message.id) ? current : [...current.slice(-40), { id: message.id, user: message.nickname, text: message.content }]);
    });
    socket.on("connect_error", (error) => {
      setRoomTip(error.message || "实时连接失败");
      window.setTimeout(() => setRoomTip(null), 1600);
    });

    socket.connect();

    return () => {
      socket.emit("leave_live_session", { liveSessionId: liveId });
      if (auctionIdRef.current) socket.emit("leave_auction", { auctionId: auctionIdRef.current });
      socket.disconnect();
      socketRef.current = null;
      if (liveEndedTimer.current) {
        window.clearTimeout(liveEndedTimer.current);
        liveEndedTimer.current = null;
      }
    };
  }, [liveId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !auctionId) return;
    socket.emit("join_auction", { auctionId }, () => undefined);
    return () => {
      socket.emit("leave_auction", { auctionId });
    };
  }, [auctionId]);

  const scrollCommentsToLatest = () => {
    const node = commentsRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  };

  const commentCount = comments.length;

  useEffect(() => {
    scrollCommentsToLatest();
  }, [expandedProduct, commentCount]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(scrollCommentsToLatest);
    return () => {
      window.cancelAnimationFrame(frameId);
      if (scrollIdleTimer.current) {
        window.clearTimeout(scrollIdleTimer.current);
      }
    };
  }, []);

  const handleCommentScroll = () => {
    if (scrollIdleTimer.current) {
      window.clearTimeout(scrollIdleTimer.current);
    }
    scrollIdleTimer.current = window.setTimeout(scrollCommentsToLatest, 900);
  };

  if (!room) {
    return (
      <main className="live-room">
        <div className="auth-loading">
          <span />
          正在进入直播间...
        </div>
      </main>
    );
  }

  return (
    <main className="live-room">
      <div className={`live-stage cover-${room.coverTone}`}>
        <header className="live-topbar">
          <div className="host-face">{room.merchant.slice(0, 1) || "商"}</div>
          <div>
            <h1>{room.title}</h1>
            <p>{room.merchant} <span>●</span></p>
          </div>
          <span className="live-pill">直播中</span>
          <button aria-label="返回" type="button" onClick={() => navigate(source)}>
            <X size={28} />
          </button>
        </header>

        <div className="live-float-row">
          <button type="button" onClick={() => {
            setRoomTip(`本场已拍 ${room.soldCount} 件`);
            window.setTimeout(() => setRoomTip(null), 1400);
          }}>
            <ClipboardList size={16} />
            本场已拍 {room.soldCount} 件
          </button>
          <button type="button" onClick={() => {
            setRoomTip(`当前在线 ${room.viewers} 人`);
            window.setTimeout(() => setRoomTip(null), 1400);
          }}>
            <User size={16} />
            {room.viewers}
          </button>
        </div>
        {roomTip && <div className="live-room-tip">{roomTip}</div>}

      </div>

      <div className={expandedProduct ? "live-bottom-stack is-expanded" : "live-bottom-stack"}>
        <div className="chat-feed" ref={commentsRef} onScroll={handleCommentScroll}>
          {comments.length ? comments.map((comment) => (
            <p key={comment.id}><b>{comment.user}：</b>{comment.text}</p>
          )) : <p className="system-comment">暂无评论，来发第一条吧</p>}
        </div>

        {expandedProduct && (
          <section className="live-auction-card">
            <div className="card-label">当前拍品</div>
            <button className="soft-link" type="button" onClick={() => setPanel("queue")}>共 {queue.length} 件拍品 <ChevronRight size={16} /></button>
            {product ? (
              <>
                <div className="auction-compact-row">
                  <ProductArt tone={product.imageTone} imageUrl={product.imageUrl} label={product.name} />
                  <div>
                    <h2>{product.name}</h2>
                    <p>{product.lotNo}</p>
                    <strong>{money(product.currentPrice)}</strong>
                  </div>
                  <button type="button" onClick={() => setExpandedProduct(false)}>收起</button>
                </div>
                <div className="auction-metrics">
                  <span>加价幅度 <strong>{money(product.increment)}</strong></span>
                  <span>封顶价 <strong>{money(product.capPrice)}</strong></span>
                  <span>距结束 <b>{product.countdown}</b></span>
                  <span>当前领先 <strong>{product.leader}</strong></span>
                </div>
                <div className="my-bid-strip">
                  <span>下一口价：{money(product.nextPrice)}</span>
                  <button type="button" onClick={() => setPanel("ranking")}>参与人数：{ranking.length} <ChevronRight size={15} /></button>
                </div>
                <button className="primary-cta" type="button" onClick={() => setPanel("bid")}>
                  立即出价 {money(product.nextPrice)}
                </button>
              </>
            ) : (
              <div className="auction-empty-state">
                <div className="empty-product-art">无</div>
                <h2>暂无当前拍品</h2>
                <p>本场还没有新的拍品开始竞拍</p>
              </div>
            )}
          </section>
        )}

        {!expandedProduct && (
          <section className="next-products">
            {previewProducts.map((item) => (
              <article
                className={`${item.type === "current" ? "is-current" : "is-next"}${!item.product ? " is-empty" : ""}`}
                key={item.type}
                role={item.product ? "button" : undefined}
                tabIndex={item.product ? 0 : -1}
                onClick={item.type === "current" ? () => setExpandedProduct(true) : item.product ? () => setPanel("queue") : undefined}
                onKeyDown={(event) => {
                  if (!item.product) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (item.type === "current") {
                      setExpandedProduct(true);
                    } else {
                      setPanel("queue");
                    }
                  }
                }}
              >
                <span>{item.type === "current" ? "当前拍品" : "下一个拍品"}</span>
                {item.product ? <ProductArt tone={item.product.imageTone} imageUrl={item.product.imageUrl} label={item.product.name} /> : <div className="empty-product-art">无</div>}
                <div>
                  <strong>{item.product?.name ?? "无"}</strong>
                  <p>{item.type === "current" && item.product ? `当前 ${money(item.product.currentPrice)}` : item.product ? "即将开始" : "暂无下一个拍品"}</p>
                </div>
                {item.product && (
                  <em aria-hidden="true">
                    <ChevronRight size={18} />
                  </em>
                )}
              </article>
            ))}
          </section>
        )}
      </div>

      <nav className="live-tools">
        <button type="button" disabled={!product} onClick={() => setPanel("detail")}><ShoppingBag size={18} /> 商品详情</button>
        <button type="button" disabled={!product} onClick={() => setPanel("ranking")}><Trophy size={18} /> 排行榜</button>
        <button type="button" onClick={() => setPanel("queue")}><ListOrdered size={18} /> 拍品队列({queue.length})</button>
      </nav>

        <footer className="comment-bar">
        <input value={commentText} disabled={liveEnded} onChange={(event) => setCommentText(event.target.value)} placeholder={liveEnded ? "直播已结束" : commentSent ? "已发送到直播间" : "说点什么..."} />
        <button type="button" onClick={() => {
          if (liveEnded) {
            showRoomTip("直播已结束");
            return;
          }
          const content = commentText.trim();
          if (!content) {
            showRoomTip("请输入评论内容");
            return;
          }
          if (!liveId || !socketRef.current?.connected) {
            showRoomTip("直播间连接中，请稍后再试");
            return;
          }
          socketRef.current.emit("send_chat", { liveSessionId: liveId, auctionId: auctionId ?? undefined, content }, (response: { ok: boolean; message?: string }) => {
            if (!response.ok) {
              showRoomTip(response.message ?? "发送失败");
              return;
            }
            setCommentText("");
            setCommentSent(true);
            window.setTimeout(() => setCommentSent(false), 1400);
          });
        }}>
          <Send size={20} />
          发送
        </button>
      </footer>

      {panel && (
        product || panel === "queue" ? (
          <LivePanel
            panel={panel}
            product={product ?? null}
            queue={queue}
            ranking={ranking}
            auctionId={auctionId}
            socket={socketRef.current}
            onClose={() => setPanel(null)}
            onPanel={setPanel}
            onTip={(text) => {
              setRoomTip(text);
              window.setTimeout(() => setRoomTip(null), 1400);
            }}
          />
        ) : null
      )}
      {liveEnded && <LiveEndedDialog onExit={exitLiveRoom} />}
    </main>
  );
}

function LiveEndedDialog({ onExit }: { onExit: () => void }) {
  return (
    <div className="modal-layer">
      <section className="result-dialog live-ended-dialog">
        <Radio size={34} />
        <h2>直播已结束</h2>
        <p>本场直播已经结束，将自动返回直播大厅。</p>
        <button className="primary-cta" type="button" onClick={onExit}>立即返回</button>
      </section>
    </div>
  );
}

function Sheet({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  const [isClosing, setIsClosing] = useState(false);
  const requestClose = () => {
    setIsClosing(true);
    window.setTimeout(onClose, 160);
  };

  return (
    <div className={isClosing ? "modal-layer is-closing" : "modal-layer"} onClick={requestClose}>
      <section className="bottom-sheet" onClick={(event) => event.stopPropagation()}>
        <button className="sheet-close" type="button" onClick={requestClose} aria-label="关闭">
          <X size={22} />
        </button>
        <div className="sheet-handle" />
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

function LivePanel({
  panel,
  product,
  queue,
  ranking,
  auctionId,
  socket,
  onClose,
  onPanel,
  onTip
}: {
  panel: Exclude<Panel, null>;
  product: MobileProduct | null;
  queue: MobileProduct[];
  ranking: RankingRow[];
  auctionId: string | null;
  socket: ReturnType<typeof createMobileSocket> | null;
  onClose: () => void;
  onPanel: (panel: Panel) => void;
  onTip: (text: string) => void;
}) {
  const [queueReminded, setQueueReminded] = useState<string[]>([]);

  if (!product && panel !== "queue") return null;

  if (panel === "detail") {
    if (!product) return null;
    return (
      <Sheet title="商品详情" onClose={onClose}>
        <div className="detail-sheet-grid">
          <ProductArt tone={product.imageTone} imageUrl={product.imageUrl} label={product.name} />
          <div>
            <h3>{product.name}</h3>
            <p>{product.lotNo}</p>
            <p>{product.description || "暂无商品描述"}</p>
          </div>
        </div>
        <InfoTable product={product} />
        <button className="primary-cta" type="button" onClick={() => onPanel("bid")}>立即出价 {money(product.nextPrice)}</button>
      </Sheet>
    );
  }

  if (panel === "ranking") {
    if (!product) return null;
    return (
      <Sheet title="实时排行榜" onClose={onClose}>
        <div className="ranking-summary">
          <ProductArt tone={product.imageTone} imageUrl={product.imageUrl} label={product.name} />
          <div>
            <strong>{product.name}</strong>
            <p>当前最高价 <b>{money(product.currentPrice)}</b> · 距结束 <em>{product.countdown}</em></p>
          </div>
          <span>我的排名<br /><b>{ranking.find((row) => row.mine)?.rank ?? "-"}</b></span>
        </div>
        <div className="ranking-table">
          {ranking.map((row) => (
            <div className={row.mine ? "mine-row" : ""} key={row.rank}>
              <span>{row.mine ? "我" : row.rank}</span>
              <strong>{row.user}</strong>
              <b>{money(row.price)}</b>
              <em>{row.count}次</em>
              <small>{row.status}</small>
            </div>
          ))}
        </div>
        <button className="primary-cta" type="button" onClick={() => onPanel("bid")}>立即出价 {money(product.nextPrice)}</button>
      </Sheet>
    );
  }

  if (panel === "queue") {
    const queuedProducts = product ? queue.filter((item) => item.id !== product.id) : queue;
    return (
      <Sheet title={`拍品队列（共 ${queue.length} 件）`} onClose={onClose}>
        {product ? (
          <article className="queue-current">
            <span>当前拍品</span>
            <ProductArt tone={product.imageTone} imageUrl={product.imageUrl} label={product.name} />
            <div>
              <h3>{product.name}</h3>
              <p>{product.lotNo}</p>
              <strong>{money(product.currentPrice)}</strong>
            </div>
            <button type="button" onClick={() => onPanel("bid")}>去出价</button>
          </article>
        ) : (
          <article className="queue-current is-empty">
            <span>当前拍品</span>
            <div className="empty-product-art">无</div>
            <div>
              <h3>暂无当前拍品</h3>
              <p>等待下一轮竞拍开始</p>
            </div>
          </article>
        )}
        <h3 className="queue-title">待讲解 / 即将开始（{queuedProducts.length}）</h3>
        {queuedProducts.map((item) => (
          <article className="queue-row" key={item.id}>
            <ProductArt tone={item.imageTone} imageUrl={item.imageUrl} label={item.name} />
            <div>
              <strong>{item.name}</strong>
              <p>{item.lotNo}</p>
            </div>
            <button type="button" onClick={() => setQueueReminded((current) => current.includes(item.id) ? current : [...current, item.id])}>
              <Bell size={16} /> {queueReminded.includes(item.id) ? "已提醒" : "提醒我"}
            </button>
          </article>
        ))}
      </Sheet>
    );
  }

  if (panel === "bid") {
    if (!product) return null;
    return <BidSheet product={product} auctionId={auctionId} socket={socket} onClose={onClose} onPanel={onPanel} onTip={onTip} />;
  }

  if (!product) return null;

  if (panel === "lost") {
    return (
      <ResultDialog title="落槌定音" subtitle="本轮竞拍已结束" product={product} onClose={onClose} action="继续看下一件" />
    );
  }

  return <ResultDialog title="恭喜竞拍成功" subtitle="您已成功竞得该拍品" product={product} onClose={onClose} action="确认地址并支付" />;
}

function ResultDialog({ title, subtitle, product, action, onClose }: { title: string; subtitle: string; product: MobileProduct; action: string; onClose: () => void }) {
  const [isClosing, setIsClosing] = useState(false);
  const location = useLocation();
  const requestClose = () => {
    setIsClosing(true);
    window.setTimeout(onClose, 160);
  };

  return (
    <div className={isClosing ? "modal-layer is-closing" : "modal-layer"} onClick={requestClose}>
      <section className="result-dialog" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p>{subtitle}</p>
        <div className="result-product">
          <ProductArt tone={product.imageTone} imageUrl={product.imageUrl} label={product.name} />
          <div>
            <h3>{product.name}</h3>
            <span>{product.lotNo}</span>
            <strong>{money(product.currentPrice)}</strong>
          </div>
        </div>
        <div className="result-info">
          <span>请在 30 分钟内完成支付，超时将自动取消</span>
        </div>
        <Link className="primary-cta" to="/mobile/orders" state={{ from: routeSource(location) }}>{action}</Link>
        <button className="ghost-cta" type="button" onClick={requestClose}>返回直播间</button>
      </section>
    </div>
  );
}

function BidSheet({
  product,
  auctionId,
  socket,
  onClose,
  onPanel,
  onTip
}: {
  product: MobileProduct;
  auctionId: string | null;
  socket: ReturnType<typeof createMobileSocket> | null;
  onClose: () => void;
  onPanel: (panel: Panel) => void;
  onTip: (text: string) => void;
}) {
  const [bidPrice, setBidPrice] = useState(product.nextPrice);

  return (
    <Sheet title="立即出价" onClose={onClose}>
      <div className="bid-modal-product">
        <ProductArt tone={product.imageTone} imageUrl={product.imageUrl} label={product.name} />
        <div>
          <h3>{product.name}</h3>
          <p>距竞拍结束仅剩 <b>{product.countdown}</b></p>
          <div>
            <span>当前最高价 <strong>{money(product.currentPrice)}</strong></span>
            <span>下一口价 <strong>{money(product.nextPrice)}</strong></span>
          </div>
        </div>
      </div>
      <div className="bid-stepper">
        <button type="button" onClick={() => setBidPrice((value) => Math.max(product.nextPrice, value - product.increment))}>−</button>
        <strong>{money(bidPrice)}</strong>
        <button type="button" onClick={() => setBidPrice((value) => Math.min(product.capPrice, value + product.increment))}>＋</button>
      </div>
      <p className="bid-tip">高于当前价 {money(product.increment)}，出价即视为同意竞拍规则</p>
      <button className="primary-cta" type="button" onClick={() => {
        if (!auctionId || !socket) {
          onTip("当前没有可出价的竞拍");
          return;
        }
        socket.emit("place_bid", { auctionId, amount: bidPrice }, (response: { ok: boolean; message?: string }) => {
          if (!response.ok) {
            onTip(response.message ?? "出价失败");
            return;
          }
          onTip("出价成功");
          onClose();
        });
      }}>立即出价</button>
    </Sheet>
  );
}

function OrdersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = ["全部", "待支付", "待发货", "已发货", "已完成"];
  const initialTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(tabs.includes(initialTab ?? "") ? initialTab! : "全部");
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const list = tab === "全部" ? orders : orders.filter((order) => order.status === tab);

  useEffect(() => {
    fetchMobileOrders(getMobileToken())
      .then(({ orders }) => setOrders(orders))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mobile-shell page-shell">
      <PageHeader title="我的订单" fallback="/mobile/mine" />
      <div className="page-tabs">
        {tabs.map((item) => (
          <button
            className={tab === item ? "active" : ""}
            key={item}
            type="button"
            onClick={() => {
              setTab(item);
              navigate(`/mobile/orders?tab=${encodeURIComponent(item)}`, { replace: true, state: location.state });
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="order-list">
        {loading && <div className="empty-block table-empty">正在加载订单...</div>}
        {!loading && list.length === 0 && <div className="empty-block table-empty">暂无订单</div>}
        {list.map((order) => <OrderCard key={order.id} order={order} from={routeSource(location)} />)}
      </div>
    </main>
  );
}

function OrderCard({ order, from }: { order: MobileOrder; from: string }) {
  return (
    <article className="order-card">
      <header>
        <span><Radio size={17} /> {order.liveTitle}</span>
        <b>{order.status}</b>
      </header>
      <div className="order-product">
        <ProductArt tone={order.product.imageTone} imageUrl={order.product.imageUrl} label={order.product.name} />
        <div>
          <h3>{order.product.name}</h3>
          <p>订单编号：{order.id}</p>
          <div className="price-box">
            成交价 <strong>{money(order.paidAmount)}</strong>
          </div>
          {order.deadline && <p className="deadline"><Clock size={15} /> 请在 <b>{order.deadline}</b> 内完成支付</p>}
        </div>
      </div>
      <footer>
        <span>实付款：<b>{money(order.paidAmount)}</b></span>
        <Link className={order.status === "待支付" ? "pay-link" : "outline-link"} to={`/mobile/orders/${order.id}`} state={{ from }}>
          {order.status === "待支付" ? "立即支付" : "查看详情"}
        </Link>
      </footer>
    </article>
  );
}

function OrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const [order, setOrder] = useState<MobileOrder | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [bidItems, setBidItems] = useState<BidHistoryItem[]>([]);
  const [status, setStatus] = useState<MobileOrder["status"]>("待支付");
  useEffect(() => {
    if (!orderId) return;
    Promise.allSettled([
      fetchMobileOrder(orderId, getMobileToken()),
      fetchAddresses(getMobileToken()),
      fetchBidHistory(getMobileToken())
    ]).then(([orderResult, addressResult, bidHistoryResult]) => {
      if (orderResult.status === "fulfilled") {
        setOrder(orderResult.value.order);
        setStatus(orderResult.value.order.status);
      } else {
        setOrder(null);
      }

      setAddresses(addressResult.status === "fulfilled" ? addressResult.value.addresses : []);
      setBidItems(bidHistoryResult.status === "fulfilled" ? bidHistoryResult.value.items : []);
    });
  }, [orderId]);

  if (!order) {
    return (
      <main className="mobile-shell page-shell order-detail">
        <PageHeader title="订单详情" fallback="/mobile/orders" />
        <div className="empty-block table-empty">正在加载订单...</div>
      </main>
    );
  }
  const canEditAddress = status === "待支付" || status === "待发货";
  const isShipped = status === "已发货";
  const address = order.address ?? addresses.find((item) => item.isDefault) ?? addresses[0] ?? null;
  const bidInfo = bidItems.find((item) => item.product.id === order.product.id);

  return (
    <main className="mobile-shell page-shell order-detail">
      <PageHeader title="订单详情" fallback="/mobile/orders" />
      <section className="pay-status">
        <Wallet size={32} />
        <div>
          <h1>{status}</h1>
          <p>{status === "待支付" ? "请完成支付，支付后等待发货" : status === "已发货" ? "商品已发出，请留意物流进度" : status === "已完成" ? "订单已完成，感谢您的竞拍" : "支付完成，请等待发货"}</p>
        </div>
        <span>{status === "待支付" ? order.deadline ?? "待支付" : status}</span>
      </section>
      <DetailBlock title="商品信息" icon={<ShoppingBag size={18} />}>
        <div className="detail-product">
          <ProductArt tone={order.product.imageTone} imageUrl={order.product.imageUrl} label={order.product.name} />
          <div>
            <h3>{order.product.name}</h3>
            <p>{order.product.lotNo}</p>
            <em>直播拍卖</em>
            <strong>{money(order.paidAmount)}</strong>
          </div>
        </div>
      </DetailBlock>
      <DetailBlock title="收货地址" icon={<MapPin size={18} />}>
        <div className="order-address-head">
          <p className="address-line">{address ? `${address.name} ｜ ${address.phone}` : "请选择收货地址"}</p>
          {canEditAddress && (
            <Link to="/mobile/addresses" state={{ from: routeSource(location), mode: "selectAddress", orderId: order.id }}>
              修改地址
            </Link>
          )}
        </div>
        <p>{address?.detail ?? "当前账号还没有收货地址，请先新增或选择默认地址。"}</p>
      </DetailBlock>
      {isShipped && (
        <DetailBlock title="物流信息" icon={<Truck size={18} />}>
          {order.logistics ? (
            <>
              <div className="logistics-summary">
                <span>{order.logistics.company}</span>
                <strong>{order.logistics.trackingNo}</strong>
              </div>
              <div className="mobile-logistics">
                {order.logistics.steps.map((step, index) => (
                  <div className={index === 0 ? "active" : ""} key={`${step.time}-${step.text}`}>
                    <b>{step.time}</b>
                    <p>{step.text}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted-line">暂无物流单号</p>
          )}
        </DetailBlock>
      )}
      <DetailBlock title="支付信息" icon={<CreditCard size={18} />}>
        <InfoLine label="商品金额" value={money(order.paidAmount)} />
        <InfoLine label="运费" value="¥0.00" />
        <InfoLine label="应付金额" value={money(order.paidAmount)} strong />
      </DetailBlock>
      <DetailBlock title="竞拍信息" icon={<Gavel size={18} />}>
        <InfoLine label="直播间" value={order.liveTitle} />
        <InfoLine label="竞拍结束时间" value="以订单生成时间为准" />
        <InfoLine label="出价次数" value={bidInfo ? `${bidInfo.bidCount}次` : "暂无记录"} />
        <InfoLine label="最终成交价" value={money(order.paidAmount)} strong />
      </DetailBlock>
      <DetailBlock title="订单编号" icon={<ClipboardList size={18} />}>
        <InfoLine label={order.id} value="复制" />
      </DetailBlock>
      <footer className="pay-footer">
        <div>
          <span>{status === "已发货" ? "物流状态" : "应付金额"}</span>
          <strong>{money(order.paidAmount)}</strong>
        </div>
        <div className="pay-footer-actions">
          {status === "待支付" && <button type="button" onClick={() => {
            payMobileOrder(order.id, getMobileToken()).then(({ order }) => {
              setOrder(order);
              setStatus(order.status);
            }).catch((error) => window.alert(error instanceof Error ? error.message : "支付失败"));
          }}>立即支付</button>}
          {status === "待支付" && <button type="button" className="ghost-action" onClick={() => {
            cancelMobileOrder(order.id, getMobileToken()).then(({ order }) => {
              setOrder(order);
              setStatus(order.status);
            }).catch((error) => window.alert(error instanceof Error ? error.message : "取消失败"));
          }}>取消订单</button>}
          {status === "待发货" && (
            <Link className="pay-link" to="/mobile/addresses" state={{ from: routeSource(location), mode: "selectAddress", orderId: order.id }}>
              修改地址
            </Link>
          )}
          {status === "已发货" && <button type="button" onClick={() => {
            completeMobileOrder(order.id, getMobileToken()).then(({ order }) => {
              setOrder(order);
              setStatus(order.status);
            });
          }}>确认收货</button>}
          {status === "已完成" && <button type="button">已完成</button>}
        </div>
      </footer>
    </main>
  );
}

function BidHistoryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = ["全部", "竞拍中", "已拍中", "未拍中", "已取消"];
  const initialTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(tabs.includes(initialTab ?? "") ? initialTab! : "竞拍中");
  const [items, setItems] = useState<BidHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const list = useMemo(() => tab === "全部" ? items : items.filter((item) => item.status === tab), [items, tab]);

  useEffect(() => {
    fetchBidHistory(getMobileToken())
      .then(({ items }) => setItems(items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mobile-shell page-shell">
      <PageHeader title="我的竞拍记录" fallback="/mobile/mine" />
      <div className="page-tabs compact">
        {tabs.map((item) => (
          <button
            className={tab === item ? "active" : ""}
            key={item}
            type="button"
            onClick={() => {
              setTab(item);
              navigate(`/mobile/bid-history?tab=${encodeURIComponent(item)}`, { replace: true, state: location.state });
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="bid-history-list">
        {loading && <div className="empty-block table-empty">正在加载竞拍记录...</div>}
        {!loading && list.length === 0 && <div className="empty-block table-empty">暂无竞拍记录</div>}
        {list.map((item) => (
          <article className="bid-history-card" key={item.id}>
            <ProductArt tone={item.product.imageTone} imageUrl={item.product.imageUrl} label={item.product.name} />
            <div>
              <span>{item.status}</span>
              <h3>{item.product.name}</h3>
              <p>{item.product.lotNo}</p>
              <div>
                <strong>我的出价 {money(item.myBid)}</strong>
                <em>出价 {item.bidCount} 次</em>
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

function AddressesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as (RouteState & { mode?: string; orderId?: string }) | null;
  const source = routeState?.from;
  const selectingForOrder = routeState?.mode === "selectAddress";
  const orderId = routeState?.orderId;
  const emptyAddress: Address = { id: "", name: "", phone: "", detail: "", isDefault: false };
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [editingAddress, setEditingAddress] = useState<Address | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchAddresses(getMobileToken())
      .then(({ addresses }) => setAddresses(addresses))
      .catch(() => setAddresses([]));
  }, []);

  const showAddressNotice = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 1600);
  };

  const setDefaultAddressRequest = (addressId: string) => {
    setDefaultAddressApi(addressId, getMobileToken())
      .then(({ addresses }) => {
        setAddresses(addresses);
        showAddressNotice("已设为默认地址");
      })
      .catch((error) => showAddressNotice(error instanceof Error ? error.message : "设置失败"));
  };

  const chooseAddress = (addressId: string) => {
    const afterChoose = () => {
      if (source) window.setTimeout(() => navigate(source), 180);
    };
    setDefaultAddressApi(addressId, getMobileToken())
      .then(({ addresses }) => {
        setAddresses(addresses);
        return orderId ? updateMobileOrderAddress(orderId, addressId, getMobileToken()) : null;
      })
      .then(() => {
        showAddressNotice("收货地址已选择");
        afterChoose();
      })
      .catch((error) => showAddressNotice(error instanceof Error ? error.message : "选择失败"));
  };

  const saveAddress = () => {
    if (!editingAddress) return;
    const payload = { name: editingAddress.name, phone: editingAddress.phone, detail: editingAddress.detail };
    const afterSave = (message: string, addressId?: string) => {
      setEditingAddress(null);
      const assignOrder = orderId && addressId ? updateMobileOrderAddress(orderId, addressId, getMobileToken()) : Promise.resolve();
      assignOrder
        .then(() => {
          showAddressNotice(message);
          if (source) window.setTimeout(() => navigate(source), 180);
        })
        .catch((error) => showAddressNotice(error instanceof Error ? error.message : "保存失败"));
    };

    if (editingAddress.id) {
      updateAddress(editingAddress.id, payload, getMobileToken())
        .then(({ address }) => {
          setAddresses((current) => current.map((item) => item.id === address.id ? address : item));
          afterSave("地址已更新", address.id);
        })
        .catch((error) => showAddressNotice(error instanceof Error ? error.message : "保存失败"));
    } else {
      createAddress(payload, getMobileToken())
        .then(({ address }) => {
          setAddresses((current) => [address, ...current]);
          afterSave("地址已新增", address.id);
        })
        .catch((error) => showAddressNotice(error instanceof Error ? error.message : "保存失败"));
    }
  };

  return (
    <main className="mobile-shell page-shell">
      <PageHeader title="收货地址" fallback="/mobile/mine" />
      {notice && <div className="mobile-toast">{notice}</div>}
      <div className="address-list">
        {addresses.map((address) => (
          <article className="address-card" key={address.id}>
            <div>
              <MapPin size={20} />
              <div>
                <h3>{address.name} <span>{address.phone}</span></h3>
                <p>{address.detail}</p>
              </div>
            </div>
            <footer>
              <label onClick={() => setDefaultAddressRequest(address.id)}>
                <input checked={address.isDefault} readOnly type="radio" />
                {address.isDefault ? "默认地址" : "设为默认"}
              </label>
              <div className="address-actions">
                {selectingForOrder && <button type="button" onClick={() => chooseAddress(address.id)}>选择此地址</button>}
                <button type="button" onClick={() => setEditingAddress(address)}>编辑</button>
              </div>
            </footer>
          </article>
        ))}
      </div>
      <button className="fixed-primary" type="button" onClick={() => setEditingAddress(emptyAddress)}>新增收货地址</button>
      {editingAddress && (
        <div className="modal-layer" onClick={() => setEditingAddress(null)}>
          <section className="bottom-sheet" onClick={(event) => event.stopPropagation()}>
            <button className="sheet-close" type="button" onClick={() => setEditingAddress(null)} aria-label="关闭">
              <X size={22} />
            </button>
            <div className="sheet-handle" />
            <h2>{editingAddress.id ? "修改收货地址" : "新增收货地址"}</h2>
            <div className="address-edit-form">
              <label>
                收货人
                <input value={editingAddress.name} onChange={(event) => setEditingAddress({ ...editingAddress, name: event.target.value })} />
              </label>
              <label>
                手机号
                <input value={editingAddress.phone} onChange={(event) => setEditingAddress({ ...editingAddress, phone: event.target.value })} />
              </label>
              <label>
                详细地址
                <textarea value={editingAddress.detail} onChange={(event) => setEditingAddress({ ...editingAddress, detail: event.target.value })} />
              </label>
              <button className="primary-cta" type="button" onClick={saveAddress}>{editingAddress.id ? "保存修改" : "保存地址"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SettingsPage({ user, onLogout }: { user: AuthUser | null; onLogout: () => void }) {
  const [tip, setTip] = useState<string | null>(null);
  const settings = [
    { icon: User, label: "账号信息", value: user?.nickname ?? "未命名用户" },
    { icon: MessageCircle, label: "联系客服", value: "在线客服 09:00-22:00" },
    { icon: Bell, label: "开播提醒", value: "已开启" },
    { icon: ShieldIcon, label: "隐私与安全", value: "账号保护中" }
  ];

  return (
    <main className="mobile-shell page-shell">
      <PageHeader title="客服 / 设置" fallback="/mobile/mine" />
      {tip && <div className="mobile-toast">{tip}</div>}
      <section className="settings-profile">
        <div className="mine-avatar">{user?.nickname?.slice(0, 1) || "用"}</div>
        <div>
          <h1>{user?.nickname ?? "用户"}</h1>
          <p>{user?.email ?? "当前登录账号"}</p>
        </div>
      </section>
      <section className="settings-list">
        {settings.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.label} type="button" onClick={() => {
              setTip(`${item.label}即将开放`);
              window.setTimeout(() => setTip(null), 1400);
            }}>
              <Icon size={20} />
              <span>{item.label}</span>
              <em>{item.value}</em>
              <ChevronRight size={18} />
            </button>
          );
        })}
      </section>
      <button className="logout-button" type="button" onClick={onLogout}>退出登录</button>
    </main>
  );
}

function ShieldIcon({ size = 20 }: { size?: number }) {
  return <Wallet size={size} />;
}

function PageHeader({ title, fallback = "/mobile/mine" }: { title: string; fallback?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const source = (location.state as RouteState | null)?.from;
  return (
    <header className="page-header">
      <button type="button" onClick={() => navigate(source ?? fallback)} aria-label="返回">
        <ChevronLeft size={28} />
      </button>
      <h1>{title}</h1>
      <span />
    </header>
  );
}

function DetailBlock({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="detail-block">
      <h2>{icon}{title}</h2>
      {children}
    </section>
  );
}

function InfoLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="info-line">
      <span>{label}</span>
      <b className={strong ? "accent" : ""}>{value}</b>
    </p>
  );
}

function InfoTable({ product }: { product: MobileProduct }) {
  return (
    <div className="info-table">
      <InfoLine label="起拍价" value={money(product.startPrice)} />
      <InfoLine label="加价幅度" value={money(product.increment)} />
      <InfoLine label="封顶价" value={money(product.capPrice)} />
      <InfoLine label="当前价" value={money(product.currentPrice)} />
    </div>
  );
}

function LoginPage({ onAuthenticated }: { onAuthenticated: (response: AuthResponse) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setSubmitting(true);

    try {
      const response = mode === "login" ? await login(email, password) : await register(nickname, email, password);
      if (response.user.role !== "CUSTOMER") {
        setMessage("请使用用户账号登录手机端");
        return;
      }
      onAuthenticated(response);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mobile-shell login-shell">
      <section className="login-hero">
        <div className="login-brand">
          <Gavel size={28} />
          <span>LiveBidX</span>
        </div>
        <h1>欢迎来到实时竞拍大师</h1>
        <p>登录后进入直播间，参与实时出价、查看订单和竞拍记录。</p>
      </section>

      <form className="login-card" onSubmit={handleSubmit}>
        <h2>{mode === "login" ? "手机端登录" : "注册用户账号"}</h2>
        <div className="login-tabs">
          <button className={mode === "login" ? "active" : ""} type="button" onClick={() => setMode("login")}>登录</button>
          <button className={mode === "register" ? "active" : ""} type="button" onClick={() => setMode("register")}>注册</button>
        </div>
        {mode === "register" && (
          <label>
            <span>昵称</span>
            <input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="请输入昵称" />
          </label>
        )}
        <label>
          <span>邮箱</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="请输入邮箱" />
        </label>
        <label>
          <span>密码</span>
          <div className="password-field">
            <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" />
            <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>
              {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </label>
        {message && <p className="login-error">{message}</p>}
        <button className="primary-cta" disabled={submitting} type="submit">
          {submitting ? "处理中..." : mode === "login" ? "登录并进入直播大厅" : "注册并进入直播大厅"}
        </button>
        <p className="login-note">{mode === "login" ? "没有账号？点击上方注册，创建账号后参与竞拍。" : "注册后可进入直播间出价，并查看订单和竞拍记录。"}</p>
      </form>
    </main>
  );
}

export default function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem(MOBILE_AUTH_USER_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved) as AuthUser;
    } catch {
      localStorage.removeItem(MOBILE_AUTH_USER_KEY);
      return null;
    }
  });
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(MOBILE_AUTH_TOKEN_KEY);
    if (!token) {
      setAuthReady(true);
      return;
    }

    fetchCurrentUser(token)
      .then(({ user }) => {
        if (user.role !== "CUSTOMER") {
          localStorage.removeItem(MOBILE_AUTH_TOKEN_KEY);
          localStorage.removeItem(MOBILE_AUTH_USER_KEY);
          setAuthUser(null);
          return;
        }
        setAuthUser(user);
        localStorage.setItem(MOBILE_AUTH_USER_KEY, JSON.stringify(user));
      })
      .catch(() => {
        localStorage.removeItem(MOBILE_AUTH_TOKEN_KEY);
        localStorage.removeItem(MOBILE_AUTH_USER_KEY);
        setAuthUser(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  function handleAuthenticated(response: AuthResponse) {
    localStorage.setItem(MOBILE_AUTH_TOKEN_KEY, response.token);
    localStorage.setItem(MOBILE_AUTH_USER_KEY, JSON.stringify(response.user));
    setAuthUser(response.user);
  }

  function handleLogout() {
    localStorage.removeItem(MOBILE_AUTH_TOKEN_KEY);
    localStorage.removeItem(MOBILE_AUTH_USER_KEY);
    setAuthUser(null);
  }

  const authed = Boolean(authUser);

  if (!authReady) {
    return (
      <main className="mobile-shell auth-loading">
        <span />
        正在检查登录状态...
      </main>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/mobile/login" replace />} />
      <Route path="/mobile" element={<Navigate to={authed ? "/mobile/live-hall" : "/mobile/login"} replace />} />
      <Route path="/mobile/login" element={authed ? <Navigate to="/mobile/live-hall" replace /> : <LoginPage onAuthenticated={handleAuthenticated} />} />
      <Route path="/mobile/live-hall" element={authed ? <LiveHallPage /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/mine" element={authed ? <MinePage user={authUser} /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/live/:liveId" element={authed ? <LiveRoomPage /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/orders" element={authed ? <OrdersPage /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/orders/:orderId" element={authed ? <OrderDetailPage /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/bid-history" element={authed ? <BidHistoryPage /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/addresses" element={authed ? <AddressesPage /> : <Navigate to="/mobile/login" replace />} />
      <Route path="/mobile/settings" element={authed ? <SettingsPage user={authUser} onLogout={handleLogout} /> : <Navigate to="/mobile/login" replace />} />
      <Route path="*" element={<Navigate to={authed ? "/mobile/live-hall" : "/mobile/login"} replace />} />
    </Routes>
  );
}
