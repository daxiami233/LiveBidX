export type AuthUser = {
  id: string;
  nickname: string;
  email: string;
  role: "CUSTOMER" | "HOST";
  createdAt: string;
};

export type AuthResponse = {
  user: AuthUser;
  token: string;
};

type BackendUserSummary = {
  id: string;
  nickname: string;
};

export type BackendOrderStatus = "PENDING_PAYMENT" | "PAID" | "SHIPPED" | "COMPLETED" | "CANCELLED";
export type BackendProductStatus = "DRAFT" | "REVIEWING" | "ACTIVE" | "ARCHIVED";
export type BackendAuctionStatus = "PENDING" | "RUNNING" | "ENDED" | "CANCELLED";
export type BackendLiveStatus = "SCHEDULED" | "LIVE" | "ENDED";

export type BackendBid = {
  id: string;
  auctionId: string;
  userId: string;
  amount: number;
  createdAt: string;
  user?: BackendUserSummary;
};

export type BackendAuction = {
  id: string;
  productId: string;
  hostId: string;
  liveSessionId?: string | null;
  status: BackendAuctionStatus;
  startPrice: number;
  currentPrice: number;
  minIncrement: number;
  capPrice?: number | null;
  autoExtendSec: number;
  deposit: number;
  startTime?: string | null;
  endTime?: string | null;
  highestBidderId?: string | null;
  createdAt: string;
  updatedAt: string;
  product?: BackendProduct;
  liveSession?: BackendLiveSession | null;
  highestBidder?: BackendUserSummary | null;
  bids?: BackendBid[];
  bidCount?: number;
  order?: BackendOrder | null;
};

export type BackendProduct = {
  id: string;
  hostId: string;
  title: string;
  category: string;
  imageUrl: string;
  description?: string | null;
  startPrice: number;
  deposit: number;
  minIncrement: number;
  capPrice?: number | null;
  durationSec: number;
  autoExtendSec: number;
  plannedAt?: string | null;
  estimate?: string | null;
  status: BackendProductStatus;
  createdAt: string;
  updatedAt: string;
  liveItems?: Array<{ liveSessionId: string; productId: string; liveSession?: BackendLiveSession }>;
  auctions?: BackendAuction[];
};

export type BackendLiveSession = {
  id: string;
  hostId: string;
  title: string;
  roomId: string;
  status: BackendLiveStatus;
  scheduledAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  coverImage?: string | null;
  tags: string[];
  onlineCount: number;
  networkStatus: string;
  streamStatus: string;
  currentProductId?: string | null;
  activeAuctionProductId?: string | null;
  createdAt: string;
  updatedAt: string;
  products?: Array<{ productId: string; sortOrder: number; product: BackendProduct }>;
  auctions?: BackendAuction[];
};

export type BackendOrder = {
  id: string;
  auctionId: string;
  productId: string;
  buyerId: string;
  addressId?: string | null;
  amount: number;
  status: BackendOrderStatus;
  createdAt: string;
  updatedAt: string;
  product?: BackendProduct;
  auction?: BackendAuction;
  address?: {
    id: string;
    name: string;
    phone: string;
    detail: string;
    isDefault: boolean;
  } | null;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:3000/api`;
const AUTH_TOKEN_KEY = "livebidx.auth.token";

async function request<T>(path: string, options: RequestInit = {}, auth = false) {
  const token = auth ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(typeof data.message === "string" ? data.message : "请求失败，请稍后重试");
  }

  return data as T;
}

export function login(email: string, password: string) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function register(nickname: string, email: string, password: string) {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ nickname, email, password, role: "HOST" })
  });
}

export function fetchCurrentUser(token: string) {
  return request<{ user: AuthUser }>("/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export function fetchHostProducts() {
  return request<{ products: BackendProduct[] }>("/products/my", {}, true);
}

export function createProduct(payload: Record<string, unknown>) {
  return request<{ product: BackendProduct }>("/products", {
    method: "POST",
    body: JSON.stringify(payload)
  }, true);
}

export function updateProduct(id: string, payload: Record<string, unknown>) {
  return request<{ product: BackendProduct }>(`/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }, true);
}

export function deleteProductById(id: string) {
  return request<{ message?: string }>(`/products/${id}`, { method: "DELETE" }, true);
}

export function reviewProductById(id: string, approved: boolean) {
  return request<{ product: BackendProduct; message?: string }>(`/products/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ approved })
  }, true);
}

export function fetchHostLives() {
  return request<{ lives: BackendLiveSession[] }>("/lives", {}, true);
}

export function createLive(payload: Record<string, unknown>) {
  return request<{ live: BackendLiveSession }>("/lives", {
    method: "POST",
    body: JSON.stringify(payload)
  }, true);
}

export function updateLive(id: string, payload: Record<string, unknown>) {
  return request<{ live: BackendLiveSession }>(`/lives/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }, true);
}

export function deleteLiveById(id: string) {
  return request<{ message?: string }>(`/lives/${id}`, { method: "DELETE" }, true);
}

export function addProductToLiveSession(liveId: string, productId: string) {
  return request<{ live: BackendLiveSession }>(`/lives/${liveId}/products`, {
    method: "POST",
    body: JSON.stringify({ productId })
  }, true);
}

export function removeProductFromLiveSession(liveId: string, productId: string) {
  return request<{ live: BackendLiveSession }>(`/lives/${liveId}/products/${productId}`, { method: "DELETE" }, true);
}

export function startLiveById(id: string) {
  return request<{ live: BackendLiveSession }>(`/lives/${id}/start`, { method: "POST" }, true);
}

export function endLiveById(id: string) {
  return request<{ live: BackendLiveSession }>(`/lives/${id}/end`, { method: "POST" }, true);
}

export function setCurrentLiveProduct(liveId: string, productId: string) {
  return request<{ live: BackendLiveSession }>(`/lives/${liveId}/current-product`, {
    method: "POST",
    body: JSON.stringify({ productId })
  }, true);
}

export function fetchHostAuctions() {
  return request<{ auctions: BackendAuction[] }>("/auctions/host", {}, true);
}

export function createAuction(productId: string, liveSessionId?: string, durationSeconds?: number) {
  return request<{ auction: BackendAuction }>("/auctions", {
    method: "POST",
    body: JSON.stringify({ productId, liveSessionId, durationSeconds })
  }, true);
}

export function endAuctionById(id: string) {
  return request<{ auction: BackendAuction }>(`/auctions/${id}/end`, { method: "POST" }, true);
}

export function cancelAuctionById(id: string) {
  return request<{ auction: BackendAuction; message?: string }>(`/auctions/${id}/cancel`, { method: "POST" }, true);
}

export function extendAuctionById(id: string, seconds: number) {
  return request<{ auction: BackendAuction; message?: string }>(`/auctions/${id}/extend`, {
    method: "POST",
    body: JSON.stringify({ seconds })
  }, true);
}

export function fetchHostOrders() {
  return request<{ orders: BackendOrder[] }>("/orders/host", {}, true);
}

export function closeOrderById(id: string) {
  return request<{ order: BackendOrder; message?: string }>(`/orders/${id}/close`, { method: "POST" }, true);
}

export function shipOrderById(id: string, payload: Record<string, unknown> = {}) {
  return request<{ order: BackendOrder; message?: string }>(`/orders/${id}/ship`, {
    method: "POST",
    body: JSON.stringify(payload)
  }, true);
}
