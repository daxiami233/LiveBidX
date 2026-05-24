import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  ClipboardList,
  Download,
  Gavel,
  MonitorPlay,
  PackageOpen,
  RefreshCw,
  ShieldAlert,
  Siren,
  UserRound,
  UsersRound,
  Video,
  WalletCards
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { MetricCard } from "../../components/ui/MetricCard";
import { Tag } from "../../components/ui/Tag";
import type { LiveSession, Notice, Order, Product } from "../../types/merchant";
import { money } from "../../utils/money";

type DashboardPageProps = {
  products: Product[];
  orders: Order[];
  liveSessions: LiveSession[];
  activeLive: LiveSession | null;
  username: string;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
};

export function DashboardPage({ products, orders, liveSessions, activeLive, username, onNotice }: DashboardPageProps) {
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const active = products.find((item) => item.status === "竞拍中") ?? null;
  const liveProduct = active ?? products.find((item) => activeLive?.productIds.includes(item.id)) ?? null;
  const validOrders = orders.filter((order) => order.status !== "已取消");
  const paidOrders = validOrders.filter((order) => order.paymentStatus === "已支付" || order.status === "已完成");
  const pendingOrders = orders.filter((order) => ["待支付", "已支付"].includes(order.status));
  const todayOrders = validOrders.filter((order) => order.createdAt.startsWith(today));
  const todayRevenue = todayOrders.reduce((sum, order) => sum + order.amount, 0);
  const activeAuctionCount = products.filter((item) => item.status === "竞拍中").length;
  const bidCount = products.reduce((sum, item) => sum + item.bidCount, 0);
  const pendingProducts = products.filter((item) => ["待上架", "待审核"].includes(item.status));
  const abnormalLives = liveSessions.filter((item) => item.networkStatus === "异常" || item.streamStatus === "异常");
  const endedLives = liveSessions.filter((item) => item.status === "已结束");
  const hasBusinessData = products.length > 0 || orders.length > 0 || liveSessions.length > 0;
  const rangeDays = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return 1;
    const start = new Date(dateRange.start).getTime();
    const end = new Date(dateRange.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return 7;
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
  }, [dateRange]);
  const axisLabels = useMemo(() => {
    if (!dateRange.start || !dateRange.end) return ["开始", "结束"];
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [dateRange.start, dateRange.end];
    const steps = rangeDays <= 3 ? rangeDays : 5;
    return Array.from({ length: steps }).map((_, index) => {
      const ratio = steps === 1 ? 0 : index / (steps - 1);
      const date = new Date(start.getTime() + (end.getTime() - start.getTime()) * ratio);
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${month}-${day}`;
    });
  }, [dateRange.end, dateRange.start, rangeDays]);
  const rangeOrders = useMemo(
    () =>
      validOrders.filter((order) => {
        if (!dateRange.start && !dateRange.end) return true;
        const date = order.createdAt.slice(0, 10);
        if (dateRange.start && date < dateRange.start) return false;
        if (dateRange.end && date > dateRange.end) return false;
        return true;
      }),
    [dateRange.end, dateRange.start, validOrders]
  );
  const rangeRevenue = rangeOrders.reduce((sum, order) => sum + order.amount, 0);
  const rangeBidCount = products.reduce((sum, item) => sum + item.bidCount, 0);
  const hasAnalysisData = rangeRevenue > 0 || rangeBidCount > 0 || endedLives.length > 0 || Boolean(activeLive);
  const rangeProductCount = Math.max(products.length, 1);
  const conversion = products.length ? `${Math.round((paidOrders.length / rangeProductCount) * 1000) / 10}%` : "0%";
  const analysisMetrics = {
    revenue: rangeRevenue,
    conversion,
    avgBids: products.length ? (rangeBidCount / products.length).toFixed(1) : "0",
    peak: liveSessions.reduce((max, live) => Math.max(max, live.onlineCount), 0),
    newUsers: 0
  };
  const revenueAxis = ["成交额", money(rangeRevenue), "0"];
  const bidAxis = ["出价", rangeBidCount.toLocaleString(), "0"];
  const topAuctionItems = products
    .filter((item) => item.status === "已成交" || item.bidCount > 0)
    .map((item) => ({
      name: item.title,
      amount: item.status === "已成交" ? item.currentPrice : 0,
      orders: item.status === "已成交" ? 1 : 0,
      rate: item.bidCount ? `${Math.min(100, Math.round((item.status === "已成交" ? 1 : 0) / item.bidCount * 1000) / 10)}%` : "0%"
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const maxTopAmount = Math.max(1, ...topAuctionItems.map((item) => item.amount));
  const topTotalAmount = topAuctionItems.reduce((sum, item) => sum + item.amount, 0);
  const topTotalOrders = topAuctionItems.reduce((sum, item) => sum + item.orders, 0);
  const todoItems = [
    { label: "待处理订单", value: String(pendingOrders.length), Icon: ClipboardList, to: "/orders", state: { tab: "待支付" }, notice: "已跳转到订单管理" },
    { label: "已取消订单", value: String(orders.filter((item) => item.status === "已取消").length), Icon: RefreshCw, to: "/orders", state: { tab: "已取消" }, notice: "已跳转到已取消订单" },
    { label: "待配置商品", value: String(pendingProducts.length), Icon: ShieldAlert, to: "/auction/products", state: { tab: "pending" }, notice: "已跳转到待上架商品列表" },
    { label: "直播异常", value: String(abnormalLives.length), Icon: Siren, to: "/live", state: undefined, notice: "已跳转到直播管理，查看直播间状态" }
  ];

  return (
    <>
      <div className="dashboard-hero">
        <div>
          <h1>上午好，{username} 👋</h1>
          <p>欢迎使用直播助手，祝您生意兴隆！</p>
        </div>
        <div className="dashboard-actions">
          <span>数据来源：实时数据库</span>
          <button onClick={() => onNotice("仪表盘数据已刷新")}>
            <RefreshCw size={16} />
            刷新数据
          </button>
        </div>
      </div>

      <div className="metric-grid five">
        <MetricCard icon={<WalletCards size={26} />} title="今日成交额" value={money(todayRevenue)} sub="来自今日已成交订单" />
        <MetricCard icon={<Video size={26} />} title="进行中直播" value={String(activeLive ? 1 : 0)} sub={`共 ${liveSessions.length} 场直播`} tone="purple" />
        <MetricCard icon={<Gavel size={26} />} title="进行中竞拍" value={String(activeAuctionCount)} sub={`累计出价 ${bidCount} 次`} tone="orange" />
        <MetricCard icon={<BarChart3 size={26} />} title="商品数量" value={String(products.length)} sub={`已成交 ${products.filter((item) => item.status === "已成交").length} 件`} tone="green" />
        <MetricCard icon={<ClipboardList size={26} />} title="待处理订单" value={String(pendingOrders.length)} sub={`订单总数 ${orders.length}`} tone="red" />
      </div>

      <div className="dashboard-main-grid">
        <section className={activeLive ? "panel dashboard-live-card" : "panel dashboard-live-card no-live"}>
          <div className="panel-head">
            <h2>当前直播概览</h2>
          </div>
          {activeLive ? (
            <>
              <div className="dashboard-live-content">
                <div className="live-cover-mini">
                  {liveProduct ? <img src={liveProduct.image} alt={liveProduct.title} /> : <PackageOpen size={40} />}
                  <Tag>直播中</Tag>
                </div>
                <div className="dashboard-live-info">
                  <h3>{activeLive.title} <Tag>直播中</Tag></h3>
                  <div className="live-overview-stats">
                    <span>
                      <UsersRound size={18} />
                      在线观众
                      <b>{activeLive.onlineCount.toLocaleString()}</b>
                    </span>
                    <span>
                      <PackageOpen size={18} />
                      关联商品
                      <b>{activeLive.productIds.length}</b>
                    </span>
                    <span>
                      <Gavel size={18} />
                      正在竞拍
                      <b>{activeAuctionCount}</b>
                    </span>
                  </div>
                </div>
              </div>
              <div className="current-auction-strip">
                <span>当前竞拍商品</span>
                <strong>{liveProduct?.title ?? "暂无关联拍品"}</strong>
                <span>当前最高价</span>
                <b>{liveProduct ? money(liveProduct.currentPrice) : "--"}</b>
              </div>
              <div className="dashboard-live-mini-grid">
                <span>已成交 <b>{products.filter((item) => activeLive.productIds.includes(item.id) && item.status === "已成交").length}</b></span>
                <span>待开拍 <b>{Math.max(activeLive.productIds.length - 1, 0)}</b></span>
                <span>异常提醒 <b>{abnormalLives.length}</b></span>
              </div>
            </>
          ) : (
            <div className="empty-live-state">
              <span>
                <MonitorPlay size={32} />
              </span>
              <h3>当前暂无进行中的直播</h3>
              <p>{hasBusinessData ? `待开播场次 ${liveSessions.filter((item) => item.status === "待开播").length} 场，待配置商品 ${pendingProducts.length} 件。` : "新账号暂无直播、商品和订单数据，可先创建直播或新增竞拍商品。"}</p>
              <div className="button-row">
                <Button tone="primary" onClick={() => navigate("/live")}>创建直播</Button>
                <Button onClick={() => navigate("/auction/products", { state: { tab: "pending" } })}>查看待上架商品</Button>
              </div>
            </div>
          )}
        </section>

        <section className="panel dashboard-todos">
          <h2>待办事项</h2>
          {todoItems.map(({ label, value, Icon, to, state, notice }) => (
            <button
              key={label}
              onClick={() => {
                navigate(to, state ? { state } : undefined);
                onNotice(notice);
              }}
            >
              <span>
                <Icon size={20} />
              </span>
              <strong>{label}</strong>
              <b>{value}</b>
              <em>去处理 ›</em>
            </button>
          ))}
        </section>
      </div>

      <section className="dashboard-analysis-section">
        <div className="dashboard-section-head">
          <div>
            <h2>数据分析</h2>
            <p>成交、转化、用户来源和高峰时段集中在仪表盘内复盘。</p>
          </div>
          <div className="dashboard-analysis-actions">
            <label className="date-range">
              <input
                type="date"
                value={dateRange.start}
                max={dateRange.end}
                onChange={(event) => {
                  setDateRange((current) => ({ ...current, start: event.target.value }));
                  onNotice("已按新的开始日期更新分析数据");
                }}
              />
              <span>~</span>
              <input
                type="date"
                value={dateRange.end}
                min={dateRange.start}
                onChange={(event) => {
                  setDateRange((current) => ({ ...current, end: event.target.value }));
                  onNotice("已按新的结束日期更新分析数据");
                }}
              />
            </label>
            <button onClick={() => onNotice("仪表盘分析数据已刷新")}>
              <RefreshCw size={16} /> 刷新
            </button>
            <button onClick={() => onNotice("仪表盘分析报表已导出")}>
              <Download size={16} /> 导出
            </button>
          </div>
        </div>

        {!hasAnalysisData ? (
          <section className="panel dashboard-empty-analysis">
            <span>
              <BarChart3 size={34} />
            </span>
            <h3>暂无可分析的经营数据</h3>
            <p>当你创建直播、添加商品并产生竞拍或订单后，这里会显示成交趋势、热门拍品和经营建议。</p>
            <div className="button-row">
              <Button tone="primary" onClick={() => navigate("/live/new")}>创建第一场直播</Button>
              <Button onClick={() => navigate("/auction/products/new")}>新增竞拍商品</Button>
            </div>
          </section>
        ) : (
          <>
          <div className="metric-grid five analysis-metrics">
          <MetricCard icon={<WalletCards size={24} />} title="区间成交额" value={money(analysisMetrics.revenue)} sub={`${rangeDays} 天汇总`} />
          <MetricCard icon={<Gavel size={24} />} title="竞拍转化率" value={analysisMetrics.conversion} sub="按成交订单 / 商品数计算" tone="purple" />
          <MetricCard icon={<BarChart3 size={24} />} title="平均出价次数" value={analysisMetrics.avgBids} sub="按拍品均值计算" tone="green" />
          <MetricCard icon={<UsersRound size={24} />} title="在线峰值" value={analysisMetrics.peak.toLocaleString()} sub="直播在线峰值" tone="orange" />
          <MetricCard icon={<UserRound size={24} />} title="新增用户" value={analysisMetrics.newUsers.toLocaleString()} sub="后续接入用户增长统计" />
        </div>

        <div className="dashboard-analysis-grid">
          <section className="panel analysis-chart-panel">
            <div className="panel-head">
              <h2>成交趋势</h2>
            </div>
            <div className="chart-with-y-axis">
              <div className="chart-y-axis">
                {revenueAxis.map((label) => (
                  <span key={`revenue-y-${label}`}>{label}</span>
                ))}
              </div>
              <div className="chart-plot">
                <div className="empty-block table-empty">暂无成交趋势时间序列数据</div>
                <div className="chart-axis">
                  {axisLabels.map((label) => (
                    <span key={`revenue-${label}`}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel analysis-chart-panel">
            <div className="panel-head">
              <h2>出价趋势</h2>
            </div>
            <div className="chart-with-y-axis">
              <div className="chart-y-axis">
                {bidAxis.map((label) => (
                  <span key={`bid-y-${label}`}>{label}</span>
                ))}
              </div>
              <div className="chart-plot">
                <div className="empty-block table-empty">暂无出价趋势时间序列数据</div>
                <div className="chart-axis">
                  {axisLabels.map((label) => (
                    <span key={`bid-${label}`}>{label}</span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel dashboard-hot-table analysis-top-table">
            <div className="panel-head">
              <h2>热门竞拍商品 TOP5</h2>
              <button onClick={() => navigate("/auction/products")}>查看全部商品</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>排名</th>
                  <th>商品</th>
                  <th>成交额</th>
                  <th>成交单数</th>
                  <th>转化率</th>
                </tr>
              </thead>
              <tbody>
                {topAuctionItems.length ? topAuctionItems.map((item, index) => (
                  <tr key={item.name}>
                    <td>
                      <span className="rank">{index + 1}</span>
                    </td>
                    <td>
                      <div className="top-product-cell">
                        <strong>{item.name}</strong>
                        <span>
                          <i style={{ width: `${Math.max(12, Math.round((item.amount / maxTopAmount) * 100))}%` }} />
                        </span>
                      </div>
                    </td>
                    <td>{money(item.amount)}</td>
                    <td>{item.orders}</td>
                    <td>{item.rate}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty-block table-empty">暂无成交拍品</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="top-table-summary">
              <span>TOP5 成交额 <b>{money(topTotalAmount)}</b></span>
              <span>成交单数 <b>{topTotalOrders}</b></span>
              <span>最高转化 <b>{topAuctionItems[0]?.rate ?? "0%"}</b></span>
            </div>
          </section>

          <section className="panel analysis-source-panel">
            <h2>用户来源占比</h2>
            <div className="source-body">
              <div className="donut source-donut">
                <div>
                  <span>总用户数</span>
                  <strong>{analysisMetrics.peak}</strong>
                </div>
              </div>
              <div className="source-legend">
                <span><i className="blue-dot" />直播在线 <b>{analysisMetrics.peak}</b><em>来自直播场次记录</em></span>
                <span><i className="green-dot" />订单买家 <b>{orders.length}</b><em>来自订单记录</em></span>
                <span><i className="purple-dot" />已成交商品 <b>{paidOrders.length}</b><em>来自成交订单</em></span>
                <span><i className="orange-dot" />待补充 <b>--</b><em>可接入用户来源埋点</em></span>
              </div>
            </div>
            <div className="source-kpis">
              <span>直播场次 <b>{liveSessions.length}</b></span>
              <span>成交订单 <b>{paidOrders.length}</b></span>
              <span>待优化 <b>用户来源</b></span>
              <span>分享增长 <b>待接入</b></span>
            </div>
          </section>

          <section className="panel analysis-insights">
            <div className="ai-insight-head">
              <div>
                <span>AI 数据洞察</span>
                <h2>经营建议</h2>
              </div>
              <button onClick={() => onNotice("AI 分析任务已创建，后续可接入真实模型")}>重新分析</button>
            </div>
            <div className="ai-insight-summary">
              <strong>区间内成交额 {money(analysisMetrics.revenue)}，竞拍转化率 {analysisMetrics.conversion}</strong>
              <p>系统将基于直播场次、商品成交、出价密度和用户来源生成经营建议。当前指标来自你的真实业务数据。</p>
            </div>
            <div className="ai-insight-list">
              <article>
                <b>成交机会</b>
                <p>{topAuctionItems[0] ? `当前成交最高拍品为「${topAuctionItems[0].name}」。` : "暂无成交拍品，可先完成一场竞拍。"}</p>
              </article>
              <article>
                <b>竞拍节奏</b>
                <p>平均出价次数为 {analysisMetrics.avgBids} 次，可根据真实出价密度调整讲解节奏。</p>
              </article>
              <article>
                <b>用户运营</b>
                <p>当前订单数 {orders.length}，可在后续接入用户标签后做复购运营。</p>
              </article>
            </div>
          </section>
        </div>
          </>
        )}
      </section>
    </>
  );
}
