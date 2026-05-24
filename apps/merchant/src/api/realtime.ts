import { io } from "socket.io-client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:3000/api`;
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL ?? API_BASE_URL.replace(/\/api\/?$/, "");

export function createMerchantSocket(token: string) {
  return io(REALTIME_URL, {
    auth: { token },
    autoConnect: false,
    transports: ["websocket", "polling"]
  });
}
