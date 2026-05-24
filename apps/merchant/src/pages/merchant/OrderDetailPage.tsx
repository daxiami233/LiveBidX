import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PageTitle } from "../../components/ui/PageTitle";
import type { ModalName, Order } from "../../types/merchant";
import { money } from "../../utils/money";

type OrderDetailPageProps = {
  orders: Order[];
  closeOrder: (id: string) => void;
  exportOrders: () => void;
  openModal: (modal: ModalName, product?: never, orderId?: string) => void;
};

export function OrderDetailPage({ orders, closeOrder, exportOrders, openModal }: OrderDetailPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const order = orders.find((item) => item.id === id);
  const routeState = location.state && typeof location.state === "object" ? location.state as { returnTo?: string; returnState?: Record<string, unknown>; returnLabel?: string; action?: string } : {};
  const returnTo = routeState.returnTo ?? "/orders";
  const returnLabel = routeState.returnLabel ?? "返回订单管理";

  useEffect(() => {
    if (routeState.action === "close" && order?.status === "待支付") {
      closeOrder(order.id);
      navigate(location.pathname, { replace: true, state: { returnTo, returnState: routeState.returnState, returnLabel } });
    }
  }, [closeOrder, location.pathname, navigate, order?.id, order?.status, returnLabel, returnTo, routeState.action, routeState.returnState]);

  if (!order) {
    return (
      <>
        <PageTitle eyebrow="订单管理" title="订单详情" actions={<Button onClick={() => navigate(returnTo, routeState.returnState ? { state: routeState.returnState } : undefined)}>{returnLabel}</Button>} />
        <section className="panel">
          <div className="empty-block table-empty">未找到订单数据</div>
        </section>
      </>
    );
  }

  const paymentTime = order.paymentStatus === "已支付" ? order.createdAt : "暂无支付记录";
  const logisticsText = order.status === "已完成" ? "订单已完成，物流轨迹可接入真实物流接口展示。" : "暂无物流信息，发货后可查看物流轨迹。";

  return (
    <>
      <PageTitle
        eyebrow="订单管理"
        title="订单详情"
        actions={
          <>
            <Button onClick={() => navigate(returnTo, routeState.returnState ? { state: routeState.returnState } : undefined)}>{returnLabel}</Button>
            {order.status === "待支付" && <Button onClick={() => closeOrder(order.id)}>关闭订单</Button>}
            {order.paymentStatus === "已支付" && order.status !== "已完成" && <Button tone="primary" onClick={() => openModal("ship", undefined, order.id)}>去发货</Button>}
            <Button tone="primary" onClick={exportOrders}>导出订单</Button>
          </>
        }
      />
      <section className="panel order-status-card">
        <span className="big-check">
          <CheckCircle2 size={34} />
        </span>
        <div>
          <h2>{order.status}</h2>
          <p>订单号：{order.id}</p>
        </div>
        <div className="timeline">
          <span>下单<br />{order.createdAt}</span>
          <span>支付状态<br />{order.paymentStatus}</span>
          <span>支付完成<br />{paymentTime}</span>
        </div>
      </section>
      <div className="order-detail-grid">
        <section className="panel">
          <h2>商品信息</h2>
          <div className="info-product">
            <img src={order.productImage} alt={order.productTitle} />
            <div>
              <h3>{order.productTitle}</h3>
              <p>商品ID：{order.productId}</p>
              <p>竞拍场次：{order.liveSession}</p>
            </div>
          </div>
        </section>
        <section className="panel info-list">
          <h2>买家信息</h2>
          <p>买家昵称：{order.buyer}</p>
          <p>手机号：{order.phone === "--" ? "暂无手机号" : order.phone}</p>
          <p>收货人：暂无收货信息</p>
          <p>收货地址：暂无收货地址</p>
        </section>
        <section className="panel info-list">
          <h2>金额信息</h2>
          <p>成交价：{money(order.amount)}</p>
          <p>运费：暂无运费信息</p>
          <p className="red">实付金额：{order.paymentStatus === "已支付" ? money(order.amount) : "待支付"}</p>
          <p>支付方式：暂无支付方式</p>
          <p>支付时间：{paymentTime}</p>
        </section>
        <section className="panel info-list">
          <div className="panel-head">
            <h2>物流信息</h2>
          </div>
          <p>{logisticsText}</p>
        </section>
        <section className="panel info-list wide">
          <h2>竞拍信息</h2>
          <p>竞拍场次：{order.liveSession}</p>
          <p>订单创建时间：{order.createdAt}</p>
          <p className="red">成交价：{money(order.amount)}</p>
          <div className="top-bid-box">
            <strong>出价记录</strong>
            <span>暂无出价排行榜明细，可在竞拍详情中查看数据库返回的出价记录。</span>
          </div>
        </section>
      </div>
    </>
  );
}
