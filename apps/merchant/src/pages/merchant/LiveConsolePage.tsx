import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Clock3,
  MessageCircle,
  MonitorPlay,
  PackageOpen,
  Play,
  Send,
  Smile,
  Trophy,
  UsersRound,
  Wifi
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { Tag } from "../../components/ui/Tag";
import type { BidRecord, CommentRecord, LiveSession, ModalName, Notice, Product } from "../../types/merchant";
import { money } from "../../utils/money";

const consoleQueuePageSize = 5;

type LiveConsolePageProps = {
  products: Product[];
  activeLive: LiveSession | null;
  currentLive: LiveSession | null;
  activeAuctionProduct: Product | null;
  currentExplainProduct: Product | null;
  bidRecords: BidRecord[];
  comments: CommentRecord[];
  startLive: (liveId?: string) => boolean;
  endLive: (liveId?: string) => boolean;
  selectProductForLive: (id: string) => boolean;
  startAuction: (id: string) => boolean;
  finishAuction: (id: string) => void;
  cancelAuction: (id: string) => void;
  extendAuction: (id: string, seconds: number) => void;
  sendComment: (text: string) => boolean;
  openModal: (modal: ModalName, product?: Product) => void;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
};

export function LiveConsolePage({
  products,
  activeLive,
  currentLive,
  activeAuctionProduct,
  currentExplainProduct,
  bidRecords,
  comments,
  startLive,
  endLive,
  selectProductForLive,
  startAuction,
  finishAuction,
  cancelAuction,
  extendAuction,
  sendComment,
  openModal,
  onNotice
}: LiveConsolePageProps) {
  const [extendValue, setExtendValue] = useState("30");
  const [commentText, setCommentText] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const live = activeLive ?? currentLive;
  const liveProducts = useMemo(() => {
    const ids = live?.productIds ?? [];
    return ids.map((id) => products.find((item) => item.id === id)).filter(Boolean) as Product[];
  }, [live?.productIds, products]);
  const queueProducts = useMemo(() => {
    const order: Record<string, number> = {
      竞拍中: 0,
      待开拍: 1,
      讲解中: 2,
      已成交: 3,
      流拍: 4,
      已取消: 5
    };

    return liveProducts
      .filter((product) => product.status === "竞拍中" || product.status === "待开拍" || product.status === "讲解中" || product.status === "已成交" || product.status === "流拍" || product.status === "已取消")
      .sort((a, b) => {
        const activeA = activeLive?.activeAuctionProductId === a.id ? -1 : 0;
        const activeB = activeLive?.activeAuctionProductId === b.id ? -1 : 0;
        if (activeA !== activeB) return activeA - activeB;
        return (order[a.status] ?? 99) - (order[b.status] ?? 99);
      });
  }, [activeLive?.activeAuctionProductId, liveProducts]);
  const current = activeAuctionProduct ?? currentExplainProduct ?? null;
  const pagedQueueProducts = queueProducts.slice((queuePage - 1) * consoleQueuePageSize, queuePage * consoleQueuePageSize);
  const isRunning = Boolean(activeLive);
  const isAuctionRunning = Boolean(activeAuctionProduct);
  const startDisabledReason = !isRunning ? "请先开始直播" : !current ? "没有可竞拍的当前拍品" : isAuctionRunning ? "当前拍品正在竞拍中" : "";
  const bids = bidRecords.filter((item) => item.productId === current?.id).slice(0, 5);
  const leaders = [...bids].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const visibleComments = isRunning ? comments.slice(0, 5) : [];

  return (
    <div className={isRunning ? "console-page live" : "console-page empty"}>
      {!isRunning && (
        <section className="console-status-banner">
          <span>i</span>
          <div>
            <h2>当前无进行中的直播</h2>
            <p>开始直播后，将在本页面内进行拍卖控制</p>
          </div>
          <MonitorPlay size={54} />
        </section>
      )}

      <div className="console-layout">
        <section className="panel console-phone-panel">
          <div className="console-live-meta" aria-label="直播画面状态">
            <span><Wifi size={14} /> 网络状态：<b>{isRunning ? activeLive?.networkStatus : "空闲"}</b></span>
            <span><UsersRound size={14} /> 在线人数：<b>{isRunning ? activeLive?.onlineCount.toLocaleString() : "0"}</b></span>
          </div>
          <div className={isRunning ? "console-phone live" : "console-phone"}>
            {isRunning && current ? (
              <>
                <img src={current.image} alt={current.title} />
              </>
            ) : (
              <div className="phone-empty">
                <MonitorPlay size={42} />
                <strong>直播画面</strong>
                <p>开始直播后显示竖屏直播画面</p>
              </div>
            )}
          </div>
        </section>

        <main className="console-main-stack">
          <section className="panel console-auction-panel">
            <h2>当前拍卖商品</h2>
            {isRunning && current ? (
              <div className="console-current-auction">
                <img src={current.image} alt={current.title} />
                <div>
                  <Tag>{isAuctionRunning ? "竞拍中" : "待开拍"}</Tag>
                  <h3>{current.title}</h3>
                  <p>{current.description || "商家暂未填写商品描述"}</p>
                  <div className="console-product-tags">
                    <span>{current.category}</span>
                    <span>加价 {money(current.increment)}</span>
                    <span>封顶 {money(current.capPrice)}</span>
                  </div>
                  <strong>{money(current.currentPrice)}</strong>
                </div>
              </div>
            ) : (
              <ConsoleEmpty icon={<PackageOpen size={72} />} title="当前拍卖商品：无" description={isRunning ? "拍品队列中没有可继续竞拍的商品" : "请先添加拍品并开始直播"} />
            )}
            <div className="console-auction-metrics">
              <span>当前价格 <b>{current && isRunning ? money(current.currentPrice) : "--"}</b></span>
              <span>领先出价者 <b>{current && isRunning ? current.leader ?? "--" : "--"}</b></span>
              <span>出价次数 <b>{current && isRunning ? current.bidCount : 0}</b></span>
              <span>倒计时 <b>{isAuctionRunning && current ? current.remaining : "--"}</b></span>
            </div>
            <div className="console-action-row">
              <Button tone={isRunning ? "danger" : "primary"} onClick={() => (isRunning && activeLive ? endLive(activeLive.id) : startLive(live?.id))}>
                <Play size={16} /> {isRunning ? "结束直播" : "开始直播"}
              </Button>
              <Button disabled={Boolean(startDisabledReason)} onClick={() => current && startAuction(current.id)}>开始竞拍</Button>
              {startDisabledReason && <span className="action-hint">{startDisabledReason}</span>}
              <Button disabled={!activeAuctionProduct} onClick={() => activeAuctionProduct && extendAuction(activeAuctionProduct.id, Number(extendValue))}>延长时间</Button>
              <select value={extendValue} onChange={(event) => setExtendValue(event.target.value)} aria-label="延长时间">
                <option value="10">10 秒</option>
                <option value="20">20 秒</option>
                <option value="30">30 秒</option>
              </select>
              <Button disabled={!activeAuctionProduct} onClick={() => activeAuctionProduct && cancelAuction(activeAuctionProduct.id)}>取消竞拍</Button>
              <Button disabled={!activeAuctionProduct} onClick={() => activeAuctionProduct && finishAuction(activeAuctionProduct.id)}>结束本轮</Button>
            </div>
          </section>

          <section className="panel console-queue-panel">
            <div className="panel-head">
              <h2>拍品队列</h2>
              <button onClick={() => openModal("addProduct")}>添加拍品到队列</button>
            </div>
            {queueProducts.length ? (
              <div className="auction-queue">
                {pagedQueueProducts.map((product, index) => {
                  const disabledReason = isAuctionRunning ? "竞拍中不可切换" : product.status === "已成交" || product.status === "流拍" || product.status === "已取消" ? "已结束不可选择" : "";
                  return (
                    <button
                      key={product.id}
                      className={activeLive?.currentProductId === product.id || activeLive?.activeAuctionProductId === product.id ? "active" : ""}
                      disabled={Boolean(disabledReason)}
                      title={disabledReason || "设为当前拍品"}
                      onClick={() => selectProductForLive(product.id)}
                    >
                      <span>{(queuePage - 1) * consoleQueuePageSize + index + 1}</span>
                      <img src={product.image} alt={product.title} />
                      <strong>{product.title}</strong>
                      <em>{disabledReason || (product.status === "竞拍中" ? "正在拍卖" : product.status)}</em>
                    </button>
                  );
                })}
              </div>
            ) : (
              <ConsoleEmpty icon={<PackageOpen size={48} />} title="暂无拍品" description="还没有添加拍品到本场直播中" />
            )}
            {queueProducts.length > consoleQueuePageSize && (
              <Pagination page={queuePage} pageSize={consoleQueuePageSize} total={queueProducts.length} onPageChange={setQueuePage} label="件" />
            )}
          </section>
        </main>

        <aside className="console-side-stack">
          <section className="panel console-list-card">
            <h2>实时出价记录</h2>
            {isRunning && bids.length ? bids.map((bid) => (
              <div className="bid-row" key={bid.id}>
                <span>{bid.time}</span>
                <strong>{bid.user}</strong>
                <Tag>{bid.status}</Tag>
                <b>{money(bid.amount)}</b>
              </div>
            )) : <ConsoleEmpty icon={<Clock3 size={38} />} title={isRunning ? "暂无出价记录" : "直播开始后显示"} />}
          </section>

          <section className="panel console-list-card">
            <h2>排行榜 TOP3</h2>
            {isRunning && leaders.length ? leaders.map((bid, index) => (
              <div className="leader-row" key={bid.id}>
                <span className="rank">{index + 1}</span>
                <strong>{bid.user}</strong>
                <b>{money(bid.amount)}</b>
              </div>
            )) : <ConsoleEmpty icon={<Trophy size={38} />} title="直播开始后显示" />}
          </section>

          <section className="panel console-comments">
            <div className="panel-head">
              <h2>评论区</h2>
              {isRunning && <button onClick={() => openModal("comment")}>全部</button>}
            </div>
            {visibleComments.length ? (
              <div className="comment-stream">
                {visibleComments.map((comment) => (
                  <p key={comment.id} className={comment.tone === "system" ? "system" : ""}>
                    <b>{comment.user}：</b>{comment.text}
                  </p>
                ))}
              </div>
            ) : (
              <ConsoleEmpty icon={<MessageCircle size={38} />} title={isRunning ? "暂无评论" : "直播开始后，评论将显示在这里"} />
            )}
            <div className="comment-input">
              <input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="说点什么..." disabled={!isRunning} />
              <Smile size={18} />
              <button disabled={!isRunning} onClick={() => { if (sendComment(commentText)) setCommentText(""); }}>
                <Send size={16} /> 发送
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ConsoleEmpty({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="console-empty-block">
      {icon}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
