import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { LiveSession, ModalName, Notice, Product } from "../../types/merchant";
import { money } from "../../utils/money";

const cardPageSize = 6;
const tablePageSize = 8;

type ProductsPageProps = {
  products: Product[];
  liveSessions: LiveSession[];
  deleteProduct: (id: string) => void;
  openModal: (modal: ModalName, product?: Product) => void;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
};

export function ProductsPage({
  products,
  liveSessions,
  deleteProduct,
  openModal,
  onNotice
}: ProductsPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const initialTab = location.state && typeof location.state === "object" && "tab" in location.state ? String(location.state.tab) : "listed";
  const initialKeyword = location.state && typeof location.state === "object" && "keyword" in location.state ? String(location.state.keyword) : "";
  const [tab, setTab] = useState(["pending", "sold"].includes(initialTab) ? initialTab : "listed");
  const [keyword, setKeyword] = useState(initialKeyword);
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [categoryFilter, setCategoryFilter] = useState("全部分类");
  const [page, setPage] = useState(1);
  const listedProducts = products
    .filter((item) => ["待开拍", "即将开拍", "讲解中", "竞拍中"].includes(item.status))
    .filter((item) => (statusFilter === "全部状态" ? true : getListedProductStatus(item) === statusFilter))
    .filter((item) => (keyword ? item.title.includes(keyword) || item.id.includes(keyword) : true));
  const pendingProducts = products
    .filter((item) => ["待上架", "待审核", "已下架"].includes(item.status))
    .filter((item) => (categoryFilter === "全部分类" ? true : item.category === categoryFilter))
    .filter((item) => (keyword ? item.title.includes(keyword) || item.id.includes(keyword) : true));
  const soldProducts = products
    .filter((item) => item.status === "已成交")
    .filter((item) => (statusFilter === "全部状态" ? true : item.status === statusFilter))
    .filter((item) => (keyword ? item.title.includes(keyword) || item.id.includes(keyword) : true));
  const activeProducts = tab === "listed" ? listedProducts : tab === "sold" ? soldProducts : pendingProducts;
  const pageSize = tab === "pending" ? tablePageSize : cardPageSize;
  const pagedProducts = activeProducts.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    const nextTab = location.state && typeof location.state === "object" && "tab" in location.state ? String(location.state.tab) : "";
    const nextKeyword = location.state && typeof location.state === "object" && "keyword" in location.state ? String(location.state.keyword) : "";
    if (["pending", "listed", "sold", "live"].includes(nextTab)) setTab(nextTab === "live" ? "listed" : nextTab);
    if (nextKeyword) setKeyword(nextKeyword);
  }, [location.state]);

  function changeTab(nextTab: string) {
    setTab(nextTab);
    setStatusFilter("全部状态");
    setPage(1);
  }

  function liveForProduct(productId: string) {
    return liveSessions.find((live) => live.productIds.includes(productId) && ["待开播", "直播中"].includes(live.status));
  }

  return (
    <>
      <PageTitle title="竞拍商品" />
      <section className="panel product-panel">
        <div className="tabs product-tabs">
          <button className={tab === "listed" ? "active" : ""} onClick={() => changeTab("listed")}>已上架</button>
          <button className={tab === "pending" ? "active" : ""} onClick={() => changeTab("pending")}>待上架</button>
          <button className={tab === "sold" ? "active" : ""} onClick={() => changeTab("sold")}>已拍卖</button>
        </div>

        {tab !== "pending" ? (
          <>
            <div className="toolbar">
              <label className="search-input">
                <Search size={18} />
                <input value={keyword} onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }} placeholder="搜索商品名称或ID" />
              </label>
              <select aria-label="状态筛选" value={statusFilter} onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}>
                <option>全部状态</option>
                {tab === "listed" ? (
                  <>
                    <option>待开拍</option>
                    <option>竞拍中</option>
                  </>
                ) : (
                  <>
                    <option>已成交</option>
                  </>
                )}
              </select>
              <Button onClick={() => onNotice("商品列表已刷新")}>
                <RefreshCw size={16} /> 刷新
              </Button>
              <Button tone="primary" onClick={() => navigate("/auction/products/new")}>添加商品</Button>
            </div>

            <div className="live-products">
              {activeProducts.length ? pagedProducts.map((product) => (
                <ProductAuctionRow
                  key={product.id}
                  product={product}
                  tab={tab}
                  live={liveForProduct(product.id)}
                  navigate={navigate}
                />
              )) : (
                <div className="empty-block list-empty">
                  <Search size={36} />
                  <strong>暂无匹配商品</strong>
                  <p>可调整搜索关键词或状态筛选后重试。</p>
                </div>
              )}
            </div>
            {activeProducts.length > pageSize && (
              <Pagination page={page} pageSize={pageSize} total={activeProducts.length} onPageChange={setPage} label="件" />
            )}
          </>
        ) : (
          <>
            <div className="toolbar">
              <label className="search-input">
                <Search size={18} />
                <input value={keyword} onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }} placeholder="搜索商品名称或ID" />
              </label>
              <select aria-label="商品分类筛选" value={categoryFilter} onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}>
                <option>全部分类</option>
                <option>水果生鲜</option>
                <option>海鲜水产</option>
                <option>休闲食品</option>
              </select>
              <label className="date-range">
                <input type="date" aria-label="开始日期" />
                <span>~</span>
                <input type="date" aria-label="结束日期" />
              </label>
              <Button tone="primary" onClick={() => navigate("/auction/products/new")}>添加商品</Button>
            </div>
            <div className="table-scroll">
              <table className="pending-products-table">
                <thead>
                  <tr>
                    <th>商品信息</th>
                    <th>起拍价</th>
                    <th>加价幅度</th>
                    <th>计划开拍时间</th>
                    <th>竞拍时长</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeProducts.length ? pagedProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="table-product">
                          <img src={product.image} alt={product.title} />
                          <div>
                            <strong>{product.title}</strong>
                            <small>{product.category}</small>
                          </div>
                        </div>
                      </td>
                      <td>{money(product.startPrice)}</td>
                      <td>{money(product.increment)}</td>
                      <td>{product.plannedTime}</td>
                      <td>{product.duration}分钟</td>
                      <td className="compact-actions">
                        <button onClick={() => navigate(`/auction/products/${product.id}/edit`)}>编辑规则</button>
                        <button onClick={() => openModal("preview", product)}>预览</button>
                        <button className="red" onClick={() => deleteProduct(product.id)}>删除</button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-block table-empty">
                          <Search size={34} />
                          <strong>暂无待上架商品</strong>
                          <p>新建商品或调整筛选条件后会显示在这里。</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {activeProducts.length > pageSize ? (
              <Pagination page={page} pageSize={pageSize} total={activeProducts.length} onPageChange={setPage} label="件" />
            ) : (
              <p className="table-footer">共 {pendingProducts.length} 条</p>
            )}
          </>
        )}
      </section>
    </>
  );
}

function getListedProductStatus(product: Product) {
  return product.status === "竞拍中" ? "竞拍中" : "待开拍";
}

function ProductAuctionRow({
  product,
  tab,
  live,
  navigate
}: {
  product: Product;
  tab: string;
  live?: LiveSession;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const listedStatus = getListedProductStatus(product);
  const isListed = tab === "listed";
  const isAuctioning = product.status === "竞拍中";
  const liveTitle = live ? live.title : "未加入直播";
  const liveStatus = live ? live.status : "待配置";

  return (
    <article className="live-product-row" key={product.id}>
      <img src={product.image} alt={product.title} />
      <div className="product-main">
        <div className="product-title-line">
          <h3>{product.title}</h3>
          {isListed && <span>{live ? liveTitle : "未配置直播场次"}</span>}
        </div>
        {isListed && (
          <div className="product-live-meta">
            <span>直播状态 <b>{liveStatus}</b></span>
            <span>计划时间 <b>{live?.scheduledAt ?? product.plannedTime}</b></span>
          </div>
        )}
        <div className="product-metrics">
          <span>起拍价 <b>{money(product.startPrice)}</b></span>
          <span>加价幅度 <b>{money(product.increment)}</b></span>
          <span>封顶价 <b>{money(product.capPrice)}</b></span>
          <span>{product.status === "已成交" ? "成交金额" : "当前价"} <b className={product.status === "已成交" ? "green" : "red"}>{money(product.currentPrice)}</b></span>
          <span>出价次数 <b>{product.bidCount}</b></span>
        </div>
      </div>
      <div className="product-state">
        <Tag>{isListed ? listedStatus : product.status}</Tag>
        {isListed ? (
          isAuctioning ? (
            <>
              <p>
                倒计时 <b>{product.remaining}</b>
              </p>
              <div className="mini-progress">
                <i style={{ width: `${product.progress}%` }} />
              </div>
            </>
          ) : (
            <p>{live ? "等待本场开拍" : "等待加入直播"}</p>
          )
        ) : (
          <p>{product.status === "已成交" ? `成交时间 ${product.soldAt ?? "--"}` : "本轮未生成订单"}</p>
        )}
      </div>
      <div className="row-actions">
        {tab === "sold" ? (
          product.status === "已成交" ? (
            <>
              {product.orderId && <Button onClick={() => navigate(`/orders/${product.orderId}`, { state: { returnTo: "/auction/products", returnState: { tab: "sold" }, returnLabel: "返回已拍卖商品" } })}>查看订单</Button>}
              <Button onClick={() => navigate(`/auction/products/${product.id}/detail`, { state: { returnTo: "/auction/products", returnState: { tab: "sold" }, returnLabel: "返回已拍卖商品" } })}>竞拍详情</Button>
            </>
          ) : (
            <Button onClick={() => navigate(`/auction/products/${product.id}/detail`, { state: { returnTo: "/auction/products", returnState: { tab: "sold" }, returnLabel: "返回已拍卖商品" } })}>查看详情</Button>
          )
        ) : live?.status === "直播中" ? null : (
          <Button onClick={() => navigate(`/auction/products/${product.id}/edit`)}>编辑</Button>
        )}
      </div>
    </article>
  );
}
