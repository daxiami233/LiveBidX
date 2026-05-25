import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BarChart3, Gavel, UsersRound, WalletCards } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { MetricCard } from "../../components/ui/MetricCard";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { LiveSession, Product } from "../../types/merchant";
import { money } from "../../utils/money";

type LiveReportPageProps = {
  liveSessions: LiveSession[];
  products: Product[];
};

export function LiveReportPage({ liveSessions, products }: LiveReportPageProps) {
  const navigate = useNavigate();
  const { id } = useParams();
  const live = liveSessions.find((item) => item.id === id) ?? liveSessions.find((item) => item.status === "已结束") ?? null;
  const liveProducts = useMemo(() => products.filter((item) => live?.productIds.includes(item.id)), [live, products]);
  const soldProducts = liveProducts.filter((item) => item.status === "已成交");
  const revenue = soldProducts.reduce((sum, item) => sum + item.currentPrice, 0);
  const orders = soldProducts.length;
  const hasRevenueTrend = revenue > 0;
  const conversion = liveProducts.length ? `${Math.round((soldProducts.length / liveProducts.length) * 100)}%` : "--";

  if (!live) {
    return (
      <>
        <PageTitle eyebrow="直播管理" title="直播数据" actions={<Button onClick={() => navigate("/live?tab=ended")}>返回已结束直播</Button>} />
        <section className="panel live-report-empty">未找到直播数据</section>
      </>
    );
  }

  return (
    <>
      <PageTitle eyebrow="直播管理" title="直播数据" actions={<Button onClick={() => navigate("/live?tab=ended")}>返回已结束直播</Button>} />
      <div className="live-report-page">
        <section className="panel live-report-hero">
          <div>
            <h2>{live.title}</h2>
            <p>直播间 ID：{live.roomId} · 主播：{live.host} · 时长：{live.durationText}</p>
          </div>
          <div className="live-config-tags">
            {live.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </section>

        <div className="metric-grid four">
          <MetricCard icon={<WalletCards size={24} />} title="成交额" value={money(revenue)} sub="单场直播汇总" />
          <MetricCard icon={<Gavel size={24} />} title="成交单数" value={String(orders)} sub="按拍品成交统计" tone="green" />
          <MetricCard icon={<UsersRound size={24} />} title="在线峰值" value={live.onlineCount.toLocaleString()} sub="直播期间最高在线" tone="orange" />
          <MetricCard icon={<BarChart3 size={24} />} title="竞拍转化率" value={conversion} sub="成交拍品 / 上架拍品" tone="purple" />
        </div>

        <div className="live-report-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>成交趋势</h2>
            </div>
            {hasRevenueTrend ? (
              <div className="chart-with-y-axis">
                <div className="chart-y-axis">
                  {["成交额", money(revenue), "0"].map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="chart-plot">
                  <div className="empty-block table-empty">暂无成交趋势时间序列数据</div>
                  <div className="chart-axis">
                    {["开播", "30 分钟", "60 分钟", "90 分钟", "结束"].map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="chart-empty-none">无</div>
            )}
          </section>
          <section className="panel live-report-insight">
            <div className="panel-head">
              <h2>复盘建议</h2>
            </div>
            <article>
              <b>拍品节奏</b>
              <p>暂无逐分钟成交数据，后续接入直播事件明细后可生成节奏建议。</p>
            </article>
            <article>
              <b>用户承接</b>
              <p>暂无用户来源与订阅数据，后续接入用户画像后可生成承接建议。</p>
            </article>
          </section>
          <section className="panel live-report-products">
            <div className="panel-head">
              <h2>拍品表现</h2>
            </div>
            <div className="live-report-product-list">
              {liveProducts.map((item) => (
                <article key={item.id}>
                  <img src={item.image} alt={item.title} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>起拍价 {money(item.startPrice)} · 成交价 {money(item.currentPrice)} · 加价幅度 {money(item.increment)}</span>
                    <span>累计出价 {item.bidCount} 次 · {item.status === "已成交" && item.leader ? `成交用户 ${item.leader}` : "未成交"}</span>
                  </div>
                  <Tag>{item.status}</Tag>
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
