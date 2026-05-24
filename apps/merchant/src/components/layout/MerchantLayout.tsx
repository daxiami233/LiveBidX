import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ChevronDown,
  ClipboardList,
  Gavel,
  Home,
  LogOut,
  MonitorPlay,
  PlayCircle,
  Radio,
  Settings,
  UserRound
} from "lucide-react";
import type { LiveSession, NavItem, Notice } from "../../types/merchant";
import type { AuthUser } from "../../api/client";

const navItems: NavItem[] = [
  { label: "仪表盘", path: "/dashboard", icon: Home },
  { label: "直播管理", path: "/live", icon: Radio },
  { label: "直播控制台", path: "/live/console", icon: MonitorPlay },
  { label: "竞拍商品", path: "/auction/products", icon: Gavel },
  { label: "订单管理", path: "/orders", icon: ClipboardList },
  { label: "设置", path: "/settings", icon: Settings }
];

type MerchantLayoutProps = {
  children: ReactNode;
  notice: Notice | null;
  onClearNotice: () => void;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
  activeLive: LiveSession | null;
  user: AuthUser;
  onLogout: () => void;
};

const crumbMap = [
  { match: "/live/console", label: "直播控制台" },
  { match: "/live/new", label: "直播管理", child: "创建直播" },
  { match: "/live", label: "直播管理" },
  { match: "/auction/products/new", label: "新增竞拍商品" },
  { match: "/auction/products", label: "竞拍商品" },
  { match: "/orders", label: "订单管理" },
  { match: "/settings", label: "设置" },
  { match: "/dashboard", label: "仪表盘" }
];

export function MerchantLayout({ children, notice, onClearNotice, onNotice, activeLive, user, onLogout }: MerchantLayoutProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const clearNoticeRef = useRef(onClearNotice);
  const matchedCrumb = crumbMap.find((item) => location.pathname.startsWith(item.match));
  const currentCrumb = matchedCrumb?.label ?? "仪表盘";
  const childCrumb =
    location.pathname.startsWith("/live/") && location.pathname.endsWith("/edit")
      ? "编辑直播"
      : location.pathname.startsWith("/live/") && location.pathname.endsWith("/report")
        ? "直播数据"
        : matchedCrumb && "child" in matchedCrumb
          ? matchedCrumb.child
          : null;

  useEffect(() => {
    clearNoticeRef.current = onClearNotice;
  }, [onClearNotice]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => clearNoticeRef.current(), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className={collapsed ? "merchant-shell menu-collapsed" : "merchant-shell"}>
      <aside className={collapsed ? "sidebar collapsed" : "sidebar"}>
        <Link to="/dashboard" className="brand-row">
          <span className="logo-mark">
            <PlayCircle size={28} fill="currentColor" />
          </span>
          <strong>直播助手</strong>
        </Link>

        <nav className="side-nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.path === "/dashboard"
                ? location.pathname === item.path
                : item.path === "/live"
                  ? location.pathname.startsWith("/live") && !location.pathname.startsWith("/live/console")
                  : location.pathname.startsWith(item.path);
            return (
              <Link key={item.path} to={item.path} className={active ? "active" : ""} title={collapsed ? item.label : undefined}>
                <Icon size={22} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <button
          className="support-button collapse-menu"
          onClick={() => {
            setCollapsed((value) => !value);
            onNotice(collapsed ? "菜单已展开" : "菜单已收起");
          }}
          title={collapsed ? "展开菜单" : "收起菜单"}
        >
          <span>‹</span>
          <b>{collapsed ? "展开菜单" : "收起菜单"}</b>
        </button>
      </aside>

      <header className={collapsed ? "merchant-header collapsed" : "merchant-header"}>
        <div className="header-left">
          <strong>{currentCrumb}</strong>
          <span>›</span>
          {childCrumb && <strong className="header-child-title">{childCrumb}</strong>}
          {activeLive && <em>直播进行中</em>}
        </div>
        <div className="header-actions">
          <div className={userMenuOpen ? "user-menu-wrap open" : "user-menu-wrap"}>
            <button className="user-card" onClick={() => setUserMenuOpen((value) => !value)}>
              <span className="avatar">
                <UserRound size={22} />
              </span>
              <div>
                <strong>{user.nickname}</strong>
                <small>{user.role === "HOST" ? "商家账号" : "用户账号"}</small>
              </div>
              <ChevronDown className="user-menu-arrow" size={16} />
            </button>
            {userMenuOpen && (
              <div className="user-dropdown">
                <div>
                  <strong>{user.nickname}</strong>
                  <span>{user.email}</span>
                </div>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={16} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="content">{children}</main>
      {notice && (
        <button className={`toast ${notice.tone ?? "success"}`} onClick={onClearNotice}>
          {notice.text}
        </button>
      )}
    </div>
  );
}
