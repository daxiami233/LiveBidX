import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, ClipboardList, Download, RefreshCw, Search, WalletCards } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { MetricCard } from "../../components/ui/MetricCard";
import { Pagination } from "../../components/ui/Pagination";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { Order } from "../../types/merchant";
import { money } from "../../utils/money";
import type { ModalName } from "../../types/merchant";

const orderPageSize = 10;

type OrdersPageProps = {
  orders: Order[];
  exportOrders: () => void;
  openModal: (modal: ModalName, product?: never, orderId?: string) => void;
};

export function OrdersPage({ orders, exportOrders, openModal }: OrdersPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const orderTabs = useMemo(() => ["全部订单", "待支付", "待发货", "已发货", "已完成", "已取消"], []);
  const stateTab = location.state && typeof location.state === "object" && "tab" in location.state ? String(location.state.tab) : "全部订单";
  const [tab, setTab] = useState(orderTabs.includes(stateTab) ? stateTab : "全部订单");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const filtered = orders
    .filter((order) => tab === "全部订单" || order.status === tab || order.paymentStatus === tab)
    .filter((order) => keyword ? order.id.includes(keyword) || order.productTitle.includes(keyword) || order.buyer.includes(keyword) : true);
  const pagedOrders = filtered.slice((page - 1) * orderPageSize, page * orderPageSize);
  const today = new Date().toISOString().slice(0, 10);
  const todayCompletedOrders = orders.filter((order) => order.createdAt.startsWith(today) && order.status !== "已取消");
  const pendingPaymentAmount = orders.filter((order) => order.status === "待支付").reduce((sum, order) => sum + order.amount, 0);
  const paidAmount = orders.filter((order) => order.paymentStatus === "已支付").reduce((sum, order) => sum + order.amount, 0);
  const cancelledCount = orders.filter((order) => order.status === "已取消").length;

  useEffect(() => {
    const nextTab = location.state && typeof location.state === "object" && "tab" in location.state ? String(location.state.tab) : "";
    if (orderTabs.includes(nextTab)) setTab(nextTab);
  }, [location.state, orderTabs]);

  return (
    <>
      <PageTitle title="订单管理" />
      <div className="tabs page-tabs">
        {orderTabs.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => {
            setTab(item);
            setPage(1);
          }}>
            {item}
          </button>
        ))}
      </div>
      <div className="metric-grid four">
        <MetricCard icon={<ClipboardList size={24} />} title="今日成交订单" value={String(todayCompletedOrders.length)} sub="来自今日订单记录" />
        <MetricCard icon={<WalletCards size={24} />} title="待支付金额" value={money(pendingPaymentAmount)} sub="待支付订单合计" tone="orange" />
        <MetricCard icon={<CheckCircle2 size={24} />} title="已支付金额" value={money(paidAmount)} sub="已支付订单合计" tone="green" />
        <MetricCard icon={<RefreshCw size={24} />} title="已取消订单" value={String(cancelledCount)} sub="已取消订单数" tone="purple" />
      </div>
      <section className="panel">
        <div className="toolbar">
          <label className="search-input">
            <Search size={18} />
            <input value={keyword} onChange={(event) => {
              setKeyword(event.target.value);
              setPage(1);
            }} placeholder="搜索订单号、商品或买家" />
          </label>
          <label className="date-range">
            <input type="date" aria-label="开始日期" />
            <span>~</span>
            <input type="date" aria-label="结束日期" />
          </label>
          <Button onClick={exportOrders}>
            <Download size={16} /> 导出订单
          </Button>
        </div>
        <div className="table-scroll orders-table-scroll">
          <table>
            <thead>
              <tr>
                <th>订单号</th>
                <th>商品信息</th>
                <th>买家</th>
                <th>成交价</th>
                <th>竞拍场次</th>
                <th>下单时间</th>
                <th>支付状态</th>
                <th>订单状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length ? pagedOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>
                    <div className="table-product">
                      <img src={order.productImage} alt={order.productTitle} />
                      <div>
                        <strong>{order.productTitle}</strong>
                        <small>{order.productId}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {order.buyer}
                    <small>{order.phone}</small>
                  </td>
                  <td>{money(order.amount)}</td>
                  <td>{order.liveSession}</td>
                  <td>{order.createdAt}</td>
                  <td>
                    <Tag>{order.paymentStatus}</Tag>
                    {order.countdown && <small className="orange-text">{order.countdown}</small>}
                  </td>
                  <td>
                    <Tag>{order.status}</Tag>
                  </td>
                  <td>
                    <div className="compact-actions">
                      <button onClick={() => navigate(`/orders/${order.id}`, { state: { returnTo: "/orders", returnLabel: "返回订单管理" } })}>查看详情</button>
                      <button onClick={() => navigate(`/auction/products/${order.productId}/detail`, { state: { returnTo: "/orders", returnLabel: "返回订单管理" } })}>竞拍详情</button>
                      {order.paymentStatus === "已支付" && order.status !== "已完成" && <button className="blue" onClick={() => openModal("ship", undefined, order.id)}>去发货</button>}
                      {order.status === "待支付" && <button onClick={() => navigate(`/orders/${order.id}`, { state: { returnTo: "/orders", returnLabel: "返回订单管理", action: "close" } })}>关闭订单</button>}
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-block table-empty">暂无订单数据</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > orderPageSize && (
          <Pagination page={page} pageSize={orderPageSize} total={filtered.length} onPageChange={setPage} label="单" />
        )}
      </section>
    </>
  );
}
