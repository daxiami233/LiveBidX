import { useLocation, useNavigate, useParams } from "react-router-dom";
import { UserRound } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { BidRecord, Product } from "../../types/merchant";
import { money } from "../../utils/money";

type ProductDetailPageProps = {
  products: Product[];
  bidRecords: BidRecord[];
  cancelAuction: (id: string) => void;
  extendAuction: (id: string, seconds: number) => void;
  finishAuction: (id: string) => void;
};

export function ProductDetailPage({ products, bidRecords, cancelAuction, extendAuction, finishAuction }: ProductDetailPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const product = products.find((item) => item.id === id);
  const routeState = location.state && typeof location.state === "object" ? location.state as { returnTo?: string; returnState?: Record<string, unknown>; returnLabel?: string } : {};
  const returnTo = routeState.returnTo ?? "/auction/products";
  const returnLabel = routeState.returnLabel ?? "返回竞拍商品";
  const bids = product ? bidRecords.filter((item) => item.productId === product.id) : [];

  if (!product) {
    return (
      <>
        <PageTitle eyebrow="竞拍商品" title="竞拍详情" actions={<Button onClick={() => navigate(returnTo, routeState.returnState ? { state: routeState.returnState } : undefined)}>{returnLabel}</Button>} />
        <section className="panel">
          <div className="empty-block table-empty">未找到商品数据</div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageTitle
        eyebrow="竞拍商品"
        title="竞拍详情"
        actions={<Button onClick={() => navigate(returnTo, routeState.returnState ? { state: routeState.returnState } : undefined)}>{returnLabel}</Button>}
      />
      <section className="panel auction-overview">
        <img src={product.image} alt={product.title} />
        <div>
          <Tag>{product.status}</Tag>
          <h2>{product.title}</h2>
          <p>商品ID：{product.id}</p>
          <div className="overview-grid">
            <span>当前最高价 <b className="red">{money(product.currentPrice)}</b></span>
            <span>起拍价 <b>{money(product.startPrice)}</b></span>
            <span>加价幅度 <b>{money(product.increment)}</b></span>
            <span>封顶价 <b>{money(product.capPrice)}</b></span>
            <span>当前领先人 <b className="blue">{product.leader ?? "--"}</b></span>
            <span>出价次数 <b>{product.bidCount}</b></span>
            <span>延时规则 <b>最后 {product.autoExtend} 秒出价自动延时</b></span>
          </div>
        </div>
        <aside className="countdown-card">
          <small>距结束还剩</small>
          <strong>{product.status === "竞拍中" ? product.remaining : "--"}</strong>
          <div className="progress-line">
            <i>
              <em style={{ width: `${product.progress}%` }} />
            </i>
            <b>{product.progress}%</b>
          </div>
          <div className="button-row wrap">
            <Button tone="primary" onClick={() => navigate("/live/console")}>进入控制台</Button>
            <Button tone="danger" disabled={product.status !== "竞拍中"} onClick={() => cancelAuction(product.id)}>取消竞拍</Button>
            <Button disabled={product.status !== "竞拍中"} onClick={() => extendAuction(product.id, 20)}>延长时间</Button>
            <Button
              disabled={product.status !== "竞拍中"}
              onClick={() => {
                finishAuction(product.id);
                navigate("/orders", { state: { tab: "待支付" } });
              }}
            >
              结束本轮
            </Button>
            {product.orderId && <Button onClick={() => navigate(`/orders/${product.orderId}`, { state: { returnTo: location.pathname, returnLabel: "返回竞拍详情" } })}>查看订单</Button>}
          </div>
        </aside>
      </section>

      <div className="detail-grid">
        <section className="panel">
          <h2>实时出价记录</h2>
          <div className="table-scroll compact-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>用户</th>
                  <th>出价金额</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {bids.length ? bids.map((bid) => (
                  <tr key={bid.id}>
                    <td>{bid.time}</td>
                    <td>{bid.user}</td>
                    <td className="red">{money(bid.amount)}</td>
                    <td>
                      <Tag>{bid.status}</Tag>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4}>
                      <div className="empty-block table-empty">暂无出价记录</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <h2>实时领先榜</h2>
          {bids.length ? bids.slice(0, 5).map((bid, index) => (
            <div className="leader-row" key={bid.id}>
              <span className="rank">{index + 1}</span>
              <UserRound size={18} />
              <strong>{bid.user}</strong>
              <b>{money(bid.amount)}</b>
            </div>
          )) : (
            <div className="empty-block table-empty">暂无领先榜数据</div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>价格趋势</h2>
            <button onClick={() => navigate("/dashboard")}>返回仪表盘</button>
          </div>
          <div className="empty-block table-empty">暂无价格趋势时间序列数据，当前仅展示数据库出价明细</div>
        </section>

        <section className="panel alerts">
          <h2>竞拍状态提醒</h2>
          {bids.length ? bids.slice(0, 3).map((bid) => (
            <p key={bid.id}>{bid.time} {bid.user} 出价 {money(bid.amount)}，状态：{bid.status}</p>
          )) : (
            <p>暂无竞拍提醒</p>
          )}
        </section>

        <section className="panel logs">
          <h2>操作日志</h2>
          <p>当前页面仅展示数据库返回的竞拍与出价信息。</p>
          <p>商品状态：{product.status}</p>
        </section>
      </div>
    </>
  );
}
