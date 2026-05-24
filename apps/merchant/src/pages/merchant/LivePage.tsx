import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Copy, ExternalLink, PackageOpen, Plus, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { LiveSession, Notice, Product } from "../../types/merchant";
import { money } from "../../utils/money";

const livePageSize = 8;

type LivePageProps = {
  products: Product[];
  liveSessions: LiveSession[];
  activeLive: LiveSession | null;
  startLive: (liveId?: string) => boolean;
  deleteLive: (liveId: string) => void;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
};

export function LivePage({ products, liveSessions, activeLive, startLive, deleteLive, onNotice }: LivePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = new URLSearchParams(location.search).get("tab") === "scheduled" ? "待开播" : new URLSearchParams(location.search).get("tab") === "ended" ? "已结束" : "直播中";
  const [tab, setTab] = useState(initialTab);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const active = products.find((item) => item.id === activeLive?.activeAuctionProductId)
    ?? products.find((item) => item.id === activeLive?.currentProductId)
    ?? null;
  const tabCounts = {
    直播中: liveSessions.filter((item) => item.status === "直播中").length,
    待开播: liveSessions.filter((item) => item.status === "待开播").length,
    已结束: liveSessions.filter((item) => item.status === "已结束").length
  };
  const filteredLives = liveSessions
    .filter((item) => item.status === tab)
    .filter((item) => keyword ? item.title.includes(keyword) || item.roomId.includes(keyword) : true);
  const pagedLives = filteredLives.slice((page - 1) * livePageSize, page * livePageSize);

  function productForLive(live: LiveSession) {
    return products.find((item) => item.id === live.activeAuctionProductId)
      ?? products.find((item) => item.id === live.currentProductId)
      ?? products.find((item) => live.productIds.includes(item.id));
  }

  function endedMetrics(live: LiveSession) {
    const liveProducts = products.filter((item) => live.productIds.includes(item.id));
    const soldProducts = liveProducts.filter((item) => item.status === "已成交");
    const revenue = soldProducts.reduce((sum, item) => sum + item.currentPrice, 0);

    return {
      revenue,
      orders: soldProducts.length,
      peak: live.onlineCount
    };
  }

  return (
    <>
      <PageTitle
        title="直播管理"
        actions={
          <Button tone="primary" onClick={() => navigate("/live/new")}>
            <Plus size={18} /> 创建直播
          </Button>
        }
      />
      <div className="live-management-page">
        <div className="live-tabs">
          {[
            ["直播中", 1],
            ["待开播", 4],
            ["已结束", 12]
          ].map(([item, count]) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => {
              setTab(String(item));
              setPage(1);
            }}>
              {item}
              <span>{tabCounts[String(item) as keyof typeof tabCounts] ?? count}</span>
            </button>
          ))}
        </div>

        {tab === "直播中" && activeLive ? (
          <section className="panel live-current-panel">
            <div className="live-current-head">
              <h2>当前直播</h2>
              <Button onClick={() => navigate("/live/console")}>进入控制台</Button>
            </div>
            <div className="live-current-body">
              <div className="live-current-cover">
                {active ? <img src={active.image} alt={activeLive.title} /> : <PackageOpen size={44} />}
                <Tag>直播中</Tag>
              </div>
              <div className="live-current-info">
                <h3>
                  {activeLive.title}
                  <button onClick={() => navigate("/live/console")}>
                    <ExternalLink size={15} />
                  </button>
                </h3>
                <p>开播时间： {activeLive.startedAt ?? activeLive.scheduledAt}</p>
                <p>直播时长： {activeLive.durationText}</p>
                <p>主播： {activeLive.host}</p>
                <p>
                  直播间ID： {activeLive.roomId} <Copy size={14} />
                </p>
              </div>
              <div className="live-stat-card">
                <span>在线人数</span>
                <strong>{activeLive.onlineCount.toLocaleString()}</strong>
                <p>来自直播间实时状态</p>
              </div>
              <div className="live-stat-card">
                <span>关联拍品数</span>
                <strong>{activeLive.productIds.length}</strong>
                <p>来自当前直播拍品队列</p>
              </div>
              <div className="live-current-product">
                <span>当前拍卖商品</span>
                {active ? (
                <div>
                  <img src={active.image} alt={active.title} />
                  <p>
                    <strong>{active.title}</strong>
                    当前价 <b>{money(active.currentPrice)}</b>
                  </p>
                </div>
                ) : (
                  <p>无当前拍品</p>
                )}
              </div>
            </div>
          </section>
        ) : tab === "直播中" ? (
          <section className="panel live-current-panel">
            <div className="empty-live-state">
              <PackageOpen size={38} />
              <h3>当前没有正在进行的直播</h3>
              <p>可从待开播场次编辑拍品与开播时间，再进入控制台开始直播。</p>
              <Button tone="primary" onClick={() => setTab("待开播")}>查看待开播</Button>
            </div>
          </section>
        ) : null}

        {tab !== "直播中" && (
        <section className="panel live-list-panel">
          <div className="live-list-head">
            <div>
              <h2>{tab === "直播中" ? "直播中场次" : tab === "待开播" ? "待开播场次" : "已结束直播"}</h2>
              <p>
                {tab === "直播中" && "正在直播的场次只展示控制台所需的实时信息。"}
                {tab === "待开播" && "待开播场次用于编辑直播信息、配置拍品队列并进入控制台。"}
                {tab === "已结束" && "已结束场次用于查看成交结果、在线峰值和复盘数据。"}
              </p>
            </div>
            <div className="live-list-filters">
              <label>
                <input type="date" aria-label="开始日期" />
                <span>~</span>
                <input type="date" aria-label="结束日期" />
              </label>
              <label>
                <input value={keyword} onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }} placeholder="搜索直播标题或ID" />
                <Search size={16} />
              </label>
            </div>
          </div>
          <div className="table-scroll live-table-scroll">
            <table className="live-list-table">
              <thead>
                {tab === "直播中" && (
                  <tr>
                    <th>直播标题</th>
                    <th>状态</th>
                    <th>开播时间</th>
                    <th>在线人数</th>
                    <th>关联拍品数</th>
                    <th>当前拍卖商品</th>
                    <th>操作</th>
                  </tr>
                )}
                {tab === "待开播" && (
                  <tr>
                    <th>直播标题</th>
                    <th>状态</th>
                    <th>计划开播时间</th>
                    <th>关联拍品数</th>
                    <th>拍品准备</th>
                    <th>直播配置</th>
                    <th>操作</th>
                  </tr>
                )}
                {tab === "已结束" && (
                  <tr>
                    <th>直播标题</th>
                    <th>状态</th>
                    <th>直播时间</th>
                    <th>成交额</th>
                    <th>成交单数</th>
                    <th>在线峰值</th>
                    <th>操作</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {pagedLives.map((live) => {
                  const liveProduct = productForLive(live);
                  const metrics = endedMetrics(live);
                  if (tab === "待开播") {
                    return (
                      <tr key={live.id}>
                        <td>
                          <strong className="live-title-text">{live.title}</strong>
                          <small>直播间ID：{live.roomId}</small>
                        </td>
                        <td>
                          <Tag>{live.status}</Tag>
                        </td>
                        <td>{live.scheduledAt}</td>
                        <td>{live.productIds.length}</td>
                        <td>
                          <div className="live-product-cell">
                            {live.productIds.length ? (
                              <>
                                <div className="live-product-stack">
                                  {products
                                    .filter((item) => live.productIds.includes(item.id))
                                    .slice(0, 3)
                                    .map((item) => (
                                      <img key={item.id} src={item.image} alt={item.title} />
                                    ))}
                                </div>
                                <p className="live-product-summary">
                                  <strong>{live.productIds.length} 件拍品已配置</strong>
                                  <b>首拍：{liveProduct?.title ?? "暂无可展示拍品"}</b>
                                </p>
                              </>
                            ) : (
                              <>
                                <span className="live-product-placeholder">
                                  <PackageOpen size={18} />
                                </span>
                                <p className="live-product-summary">
                                  <strong>暂无拍品</strong>
                                  <b>请进入编辑页添加</b>
                                </p>
                              </>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="live-config-tags">
                            <span>{live.streamStatus}</span>
                            <span>{live.networkStatus}</span>
                          </div>
                        </td>
                        <td>
                          <div className="live-row-actions">
                            <Button
                              onClick={() => {
                                startLive(live.id);
                              }}
                            >
                              开始直播
                            </Button>
                            <Button onClick={() => navigate(`/live/${live.id}/edit?from=scheduled`)}>编辑</Button>
                            <Button tone="danger" onClick={() => deleteLive(live.id)}>删除</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  if (tab === "已结束") {
                    return (
                      <tr key={live.id}>
                        <td>
                          <strong className="live-title-text">{live.title}</strong>
                          <small>直播间ID：{live.roomId}</small>
                        </td>
                        <td>
                          <Tag>{live.status}</Tag>
                        </td>
                        <td>
                          {live.startedAt ?? live.scheduledAt}
                          <small>时长：{live.durationText}</small>
                        </td>
                        <td>{money(metrics.revenue)}</td>
                        <td>{metrics.orders}</td>
                        <td>{metrics.peak.toLocaleString()}</td>
                        <td>
                          <div className="live-row-actions">
                            <Button onClick={() => navigate(`/live/${live.id}/report`)}>查看直播数据</Button>
                            <Button tone="danger" onClick={() => deleteLive(live.id)}>删除</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return null;
                })}
                {filteredLives.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <div className="live-empty-row">
                        <PackageOpen size={28} />
                        <span>{tab === "直播中" ? "暂无正在直播的场次" : tab === "待开播" ? "暂无待开播直播" : "暂无已结束直播"}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={livePageSize} total={filteredLives.length} onPageChange={setPage} label="场" />
        </section>
        )}
      </div>
    </>
  );
}
