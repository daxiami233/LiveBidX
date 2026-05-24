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

export type MobileProduct = {
  id: string;
  name: string;
  lotNo: string;
  description?: string;
  imageUrl?: string;
  imageTone: string;
  startPrice: number;
  currentPrice: number;
  nextPrice: number;
  increment: number;
  capPrice: number;
  countdown: string;
  leader: string;
};

export type MobileLiveRoom = {
  id: string;
  title: string;
  merchant: string;
  status: "live" | "upcoming";
  coverTone: string;
  viewers: string;
  heatRank: string;
  soldCount: number;
  startsAt: string;
  currentProduct: MobileProduct | null;
  auctionId?: string | null;
};

export type MobileOrder = {
  id: string;
  status: "待支付" | "待发货" | "已发货" | "已完成" | "已取消";
  liveTitle: string;
  product: MobileProduct;
  paidAmount: number;
  deadline?: string;
  logistics?: {
    company: string;
    trackingNo: string;
    steps: Array<{ time: string; text: string }>;
  };
};

export type BidHistoryItem = {
  id: string;
  status: "全部" | "竞拍中" | "已拍中" | "未拍中" | "已取消";
  product: MobileProduct;
  myBid: number;
  bidCount: number;
};

export type RankingRow = {
  rank: number;
  user: string;
  price: number;
  count: number;
  status: string;
  mine?: boolean;
};

export type Address = {
  id: string;
  name: string;
  phone: string;
  detail: string;
  isDefault: boolean;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:3000/api`;

async function request<T>(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.message === "string" ? data.message : "请求失败");
  }

  return data as T;
}

export function checkHealth() {
  return request<{ status: string; service: string }>("/health");
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
    body: JSON.stringify({ nickname, email, password, role: "CUSTOMER" })
  });
}

export function fetchCurrentUser(token: string) {
  return request<{ user: AuthUser }>("/auth/me", {}, token);
}

export function fetchMobileLiveRooms(token: string) {
  return request<{ rooms: MobileLiveRoom[] }>("/mobile/live-rooms", {}, token);
}

export function fetchMobileLiveRoom(id: string, token: string) {
  return request<{ room: MobileLiveRoom; queue: MobileProduct[]; ranking: RankingRow[]; auction: { id: string } | null }>(`/mobile/live-rooms/${id}`, {}, token);
}

export function fetchMobileOrders(token: string) {
  return request<{ orders: MobileOrder[] }>("/mobile/orders", {}, token);
}

export function fetchMobileOrder(id: string, token: string) {
  return request<{ order: MobileOrder }>(`/mobile/orders/${id}`, {}, token);
}

export function payMobileOrder(id: string, token: string) {
  return request<{ order: MobileOrder; message: string }>(`/mobile/orders/${id}/pay`, { method: "POST" }, token);
}

export function completeMobileOrder(id: string, token: string) {
  return request<{ order: MobileOrder; message: string }>(`/mobile/orders/${id}/complete`, { method: "POST" }, token);
}

export function fetchBidHistory(token: string) {
  return request<{ items: BidHistoryItem[] }>("/mobile/bid-history", {}, token);
}

export function fetchAddresses(token: string) {
  return request<{ addresses: Address[] }>("/mobile/addresses", {}, token);
}

export function createAddress(payload: Pick<Address, "name" | "phone" | "detail">, token: string) {
  return request<{ address: Address }>("/mobile/addresses", {
    method: "POST",
    body: JSON.stringify(payload)
  }, token);
}

export function updateAddress(id: string, payload: Pick<Address, "name" | "phone" | "detail">, token: string) {
  return request<{ address: Address }>(`/mobile/addresses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }, token);
}

export function setDefaultAddress(id: string, token: string) {
  return request<{ addresses: Address[] }>(`/mobile/addresses/${id}/default`, { method: "POST" }, token);
}
