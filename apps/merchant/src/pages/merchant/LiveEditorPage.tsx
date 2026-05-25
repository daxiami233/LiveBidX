import { FormEvent, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CalendarDays, PackagePlus, Radio, Save } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Pagination } from "../../components/ui/Pagination";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { LiveForm, LiveSession, Notice, Product } from "../../types/merchant";
import { money } from "../../utils/money";

const tagOptions = ["水果", "海鲜", "冷链", "家居", "新品", "福利", "复购", "限时"];
const queuePageSize = 4;
const addablePageSize = 5;

function toDateTimeInputValue(value: string) {
  if (!value || value === "待设置") return "";
  return value.replace(" ", "T").slice(0, 16);
}

function fromDateTimeInputValue(value: string) {
  return value ? value.replace("T", " ") : "";
}

type LiveEditorPageProps = {
  products: Product[];
  liveSessions: LiveSession[];
  saveLive: (id: string | undefined, form: LiveForm, productIds?: string[]) => Promise<boolean>;
  addProductToLive: (productId: string, liveId?: string) => void;
  removeProductFromLive: (productId: string, liveId?: string) => void;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
};

export function LiveEditorPage({ products, liveSessions, saveLive, addProductToLive, removeProductFromLive, onNotice }: LiveEditorPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const backPath = new URLSearchParams(location.search).get("from") === "scheduled" ? "/live?tab=scheduled" : "/live";
  const live = useMemo(() => liveSessions.find((item) => item.id === id), [id, liveSessions]);
  const [draftProductIds, setDraftProductIds] = useState<string[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const [addablePage, setAddablePage] = useState(1);
  const [addableCategory, setAddableCategory] = useState("全部分类");
  const selectedProductIds = id ? live?.productIds ?? [] : draftProductIds;
  const liveProducts = useMemo(
    () =>
      selectedProductIds
        .map((productId) => products.find((item) => item.id === productId))
        .filter(Boolean) as Product[],
    [products, selectedProductIds]
  );
  const liveStreamingProductIds = useMemo(
    () => new Set(liveSessions.filter((item) => item.status === "直播中").flatMap((item) => item.productIds)),
    [liveSessions]
  );
  const canManageProducts = id ? Boolean(live && live.status !== "已结束") : true;
  const categoryOptions = useMemo(() => ["全部分类", ...Array.from(new Set(products.map((item) => item.category).filter(Boolean)))], [products]);
  const addableProducts = useMemo(
    () =>
      products
        .filter((item) => ["待上架", "待开拍", "即将开拍"].includes(item.status))
        .filter((item) => addableCategory === "全部分类" || item.category === addableCategory)
        .filter((item) => !selectedProductIds.includes(item.id))
        .filter((item) => !liveStreamingProductIds.has(item.id)),
    [addableCategory, liveStreamingProductIds, products, selectedProductIds]
  );
  const pagedLiveProducts = liveProducts.slice((queuePage - 1) * queuePageSize, queuePage * queuePageSize);
  const pagedAddableProducts = addableProducts.slice((addablePage - 1) * addablePageSize, addablePage * addablePageSize);
  const [form, setForm] = useState<LiveForm>({
    title: live?.title ?? "",
    scheduledAt: live?.scheduledAt === "待设置" ? "" : live?.scheduledAt ?? "",
    host: live?.host ?? "",
    roomId: live?.roomId ?? "",
    tags: live?.tags.join("，") ?? ""
  });

  function update<K extends keyof LiveForm>(key: K, value: LiveForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleTag(tag: string) {
    const currentTags = form.tags
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const nextTags = currentTags.includes(tag) ? currentTags.filter((item) => item !== tag) : [...currentTags, tag];
    update("tags", nextTags.join("，"));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (live?.status === "直播中") {
      onNotice("直播中场次不能编辑基础信息，请先结束直播", "warning");
      return;
    }
    if (await saveLive(id, form, id ? undefined : draftProductIds)) navigate(backPath, { replace: true });
  }

  return (
    <>
      <PageTitle
        eyebrow="直播管理"
        title={id ? "编辑直播" : "创建直播"}
        actions={<Button onClick={() => navigate(backPath)}>返回直播管理</Button>}
      />
      <div className="live-editor-layout">
        <form className="panel live-editor-panel" onSubmit={handleSubmit}>
          <div className="live-editor-head">
            <span>
              <Radio size={22} />
            </span>
            <div>
              <h2>直播基础信息</h2>
              <p>设置直播标题、开播时间、主播和标签，保存后可在待开播列表继续管理。</p>
            </div>
          </div>
          <div className="form-grid two live-editor-form-grid">
            <label>
              <b>直播标题</b>
              <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：夏日水果专场直播" />
            </label>
            <label>
              <b>计划开播时间</b>
              <input
                type="datetime-local"
                value={toDateTimeInputValue(form.scheduledAt)}
                onChange={(event) => update("scheduledAt", fromDateTimeInputValue(event.target.value))}
              />
            </label>
            <label>
              <b>主播</b>
              <input value={form.host} onChange={(event) => update("host", event.target.value)} placeholder="请输入主播名称" />
            </label>
            <label className="system-field">
              <b>直播间 ID</b>
              <span>{form.roomId || "保存后系统自动生成"}</span>
            </label>
            <div className="wide live-editor-field">
              <b>直播标签</b>
              <div className="tag-picker">
                {tagOptions.map((tag) => {
                  const selected = form.tags.split(/[，,]/).map((item) => item.trim()).includes(tag);
                  return (
                    <button key={tag} className={selected ? "active" : ""} onClick={() => toggleTag(tag)} type="button">
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="live-editor-tips">
            <CalendarDays size={18} />
            待开播场次可继续调整基础信息和拍品队列；开播后请进入控制台操作。
          </div>
          <div className="form-actions">
            <Button type="submit" tone="primary">
              <Save size={18} />
              保存直播
            </Button>
            <Button onClick={() => navigate(backPath)}>取消</Button>
          </div>
        </form>

        <aside className="panel live-editor-side">
          <div className="live-editor-head compact">
            <span>
              <PackagePlus size={22} />
            </span>
            <div>
              <h2>拍品队列</h2>
              <p>{canManageProducts ? "待开播和直播中都可调整拍品队列；正在拍卖的商品不可移除。" : "已结束直播仅保留历史拍品记录。"}</p>
            </div>
          </div>
          <div className="editor-queue-summary">
            <span>已配置拍品 <b>{liveProducts.length}</b></span>
            <span>可添加商品 <b>{addableProducts.length}</b></span>
          </div>
          <div className="editor-queue-list">
            {liveProducts.length ? (
              pagedLiveProducts.map((item) => (
                <article key={item.id}>
                  <img src={item.image} alt={item.title} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{money(item.currentPrice)}</span>
                  </div>
                  <div className="queue-item-actions">
                    <Tag>{item.status}</Tag>
                    <button
                      type="button"
                      disabled={!canManageProducts || live?.activeAuctionProductId === item.id}
                      title={live?.activeAuctionProductId === item.id ? "正在拍卖的商品不能移除" : "从队列移除"}
                      onClick={() => {
                        if (!canManageProducts) {
                          onNotice("已结束直播不能移除拍品", "warning");
                          return;
                        }
                        if (live?.activeAuctionProductId === item.id) {
                          onNotice("正在拍卖的商品不能移除", "warning");
                          return;
                        }
                        if (id) removeProductFromLive(item.id, id);
                        else setDraftProductIds((current) => current.filter((productId) => productId !== item.id));
                      }}
                    >
                      移除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="editor-empty-queue">暂无拍品，可从下方商品加入队列。</div>
            )}
          </div>
          {liveProducts.length > queuePageSize && (
            <Pagination page={queuePage} pageSize={queuePageSize} total={liveProducts.length} onPageChange={setQueuePage} label="件" />
          )}
          <div className="editor-add-toolbar">
            <h3>可添加商品</h3>
            <select value={addableCategory} onChange={(event) => {
              setAddableCategory(event.target.value);
              setAddablePage(1);
            }}>
              {categoryOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="editor-add-list">
            {pagedAddableProducts.map((item) => (
              <article key={item.id}>
                <img src={item.image} alt={item.title} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{money(item.startPrice)} 起拍</span>
                </div>
                <button
                  disabled={!canManageProducts}
                  onClick={() => {
                    if (!canManageProducts) {
                      onNotice("已结束直播不能添加拍品", "warning");
                      return;
                    }
                    if (id) addProductToLive(item.id, id);
                    else setDraftProductIds((current) => current.includes(item.id) ? current : [...current, item.id]);
                  }}
                  type="button"
                >
                  加入
                </button>
              </article>
            ))}
            {!addableProducts.length && <div className="editor-empty-queue">暂无可添加商品，可先到竞拍商品页面上架商品。</div>}
          </div>
          {addableProducts.length > addablePageSize && (
            <Pagination page={addablePage} pageSize={addablePageSize} total={addableProducts.length} onPageChange={setAddablePage} label="件" />
          )}
        </aside>
      </div>
    </>
  );
}
