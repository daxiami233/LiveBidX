import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { fetchCurrentUser, type AuthResponse, type AuthUser } from "./api/client";
import { ConfirmDialog } from "./components/merchant/ConfirmDialog";
import { MerchantLayout } from "./components/layout/MerchantLayout";
import { MerchantModal } from "./components/merchant/MerchantModal";
import { useMerchantAdmin } from "./hooks/useMerchantAdmin";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/merchant/DashboardPage";
import { LiveConsolePage } from "./pages/merchant/LiveConsolePage";
import { LiveEditorPage } from "./pages/merchant/LiveEditorPage";
import { LivePage } from "./pages/merchant/LivePage";
import { LiveReportPage } from "./pages/merchant/LiveReportPage";
import { OrderDetailPage } from "./pages/merchant/OrderDetailPage";
import { OrdersPage } from "./pages/merchant/OrdersPage";
import { ProductDetailPage } from "./pages/merchant/ProductDetailPage";
import { ProductEditorPage } from "./pages/merchant/ProductEditorPage";
import { ProductsPage } from "./pages/merchant/ProductsPage";
import { SettingsPage } from "./pages/merchant/SettingsPage";

const AUTH_TOKEN_KEY = "livebidx.auth.token";
const AUTH_USER_KEY = "livebidx.auth.user";

export default function App() {
  const merchant = useMerchantAdmin();
  const navigate = useNavigate();
  const location = useLocation();
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem(AUTH_USER_KEY);
    if (!saved) return null;
    try {
      return JSON.parse(saved) as AuthUser;
    } catch {
      localStorage.removeItem(AUTH_USER_KEY);
      return null;
    }
  });
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
      setAuthReady(true);
      return;
    }

    fetchCurrentUser(token)
      .then(({ user }) => {
        setAuthUser(user);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      })
      .catch(() => {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        setAuthUser(null);
      })
      .finally(() => setAuthReady(true));
  }, []);

  function handleAuthenticated(response: AuthResponse) {
    localStorage.setItem(AUTH_TOKEN_KEY, response.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(response.user));
    window.dispatchEvent(new Event("livebidx-auth-changed"));
    setAuthUser(response.user);
    merchant.notify("登录成功，欢迎回来");
    navigate("/dashboard", { replace: true });
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    window.dispatchEvent(new Event("livebidx-auth-changed"));
    setAuthUser(null);
    merchant.notify("已退出登录");
    navigate("/login", { replace: true });
  }

  if (!authReady) {
    return (
      <div className="auth-loading">
        <span />
        正在检查登录状态...
      </div>
    );
  }

  if (!authUser) {
    const initialMode = location.pathname === "/register" ? "register" : "login";
    return (
      <Routes>
        <Route path="/login" element={<AuthPage initialMode={initialMode} onAuthenticated={handleAuthenticated} />} />
        <Route path="/register" element={<AuthPage initialMode="register" onAuthenticated={handleAuthenticated} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <MerchantLayout
      notice={merchant.notice}
      onClearNotice={() => merchant.setNotice(null)}
      onNotice={merchant.notify}
      activeLive={merchant.activeLive}
      user={authUser}
      onLogout={handleLogout}
    >
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage products={merchant.products} orders={merchant.orders} liveSessions={merchant.liveSessions} activeLive={merchant.activeLive} username={authUser.nickname} onNotice={merchant.notify} />} />
        <Route
          path="/live"
          element={
            <LivePage
              products={merchant.products}
              liveSessions={merchant.liveSessions}
              activeLive={merchant.activeLive}
              startLive={merchant.startLive}
              deleteLive={merchant.deleteLive}
              onNotice={merchant.notify}
            />
          }
        />
        <Route
          path="/live/new"
          element={<LiveEditorPage products={merchant.products} liveSessions={merchant.liveSessions} saveLive={merchant.saveLive} addProductToLive={merchant.addProductToLive} removeProductFromLive={merchant.removeProductFromLive} onNotice={merchant.notify} />}
        />
        <Route
          path="/live/:id/edit"
          element={<LiveEditorPage products={merchant.products} liveSessions={merchant.liveSessions} saveLive={merchant.saveLive} addProductToLive={merchant.addProductToLive} removeProductFromLive={merchant.removeProductFromLive} onNotice={merchant.notify} />}
        />
        <Route
          path="/live/:id/report"
          element={<LiveReportPage liveSessions={merchant.liveSessions} products={merchant.products} />}
        />
        <Route
          path="/live/console"
          element={
            <LiveConsolePage
              products={merchant.products}
              liveSessions={merchant.liveSessions}
              activeLive={merchant.activeLive}
              currentLive={merchant.currentLive}
              activeAuctionProduct={merchant.activeAuctionProduct}
              currentExplainProduct={merchant.currentExplainProduct}
              bidRecords={merchant.bidRecords}
              comments={merchant.comments}
              startLive={merchant.startLive}
              endLive={merchant.endLive}
              selectProductForLive={merchant.selectProductForLive}
              startAuction={merchant.startAuction}
              finishAuction={merchant.finishAuction}
              cancelAuction={merchant.cancelAuction}
              extendAuction={merchant.extendAuction}
              sendComment={merchant.sendComment}
              openModal={merchant.openModal}
              removeProductFromLive={merchant.removeProductFromLive}
              onNotice={merchant.notify}
            />
          }
        />
        <Route
          path="/auction/products"
          element={
            <ProductsPage
              products={merchant.products}
              liveSessions={merchant.liveSessions}
              deleteProduct={merchant.deleteProduct}
              openModal={merchant.openModal}
              onNotice={merchant.notify}
            />
          }
        />
        <Route path="/auction/products/new" element={<ProductEditorPage products={merchant.products} saveProduct={merchant.saveProduct} onNotice={merchant.notify} />} />
        <Route path="/auction/products/:id/edit" element={<ProductEditorPage products={merchant.products} saveProduct={merchant.saveProduct} onNotice={merchant.notify} />} />
        <Route
          path="/auction/products/:id/detail"
          element={
            <ProductDetailPage
              products={merchant.products}
              bidRecords={merchant.bidRecords}
              cancelAuction={merchant.cancelAuction}
              extendAuction={merchant.extendAuction}
              finishAuction={merchant.finishAuction}
            />
          }
        />
        <Route path="/orders" element={<OrdersPage orders={merchant.orders} exportOrders={() => merchant.notify("导出成功")} openModal={merchant.openModal} />} />
        <Route
          path="/orders/:id"
          element={
            <OrderDetailPage
              orders={merchant.orders}
              closeOrder={merchant.closeOrder}
              exportOrders={() => merchant.notify("导出成功")}
              openModal={merchant.openModal}
            />
          }
        />
        <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
        <Route path="/settings" element={<SettingsPage onNotice={merchant.notify} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      <MerchantModal
        modal={merchant.modal}
        product={merchant.modalProduct}
        orderId={merchant.modalOrderId}
        products={merchant.products}
        currentLive={merchant.currentLive}
        close={merchant.closeModal}
        onNotice={merchant.notify}
        addProductToLive={merchant.addProductToLive}
        shipOrder={merchant.shipOrder}
      />
      <ConfirmDialog confirm={merchant.confirmState} onCancel={merchant.closeConfirm} onConfirm={merchant.runConfirmed} />
    </MerchantLayout>
  );
}
