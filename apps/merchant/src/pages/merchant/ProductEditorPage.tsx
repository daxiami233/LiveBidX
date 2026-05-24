import { type ChangeEvent, type FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ImagePlus } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PageTitle } from "../../components/ui/PageTitle";
import { Tag } from "../../components/ui/Tag";
import type { Notice, Product, ProductForm } from "../../types/merchant";
import { money } from "../../utils/money";

const defaultPreviewImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'%3E%3Crect width='600' height='600' fill='%23eef3fa'/%3E%3Cpath d='M180 360l86-94 68 70 42-46 44 70H180z' fill='%23c4d0e0'/%3E%3Ccircle cx='390' cy='210' r='36' fill='%23d8e0ec'/%3E%3C/svg%3E";

type ProductEditorPageProps = {
  products: Product[];
  saveProduct: (form: ProductForm, productId?: string) => Promise<boolean>;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
};

function toDateTimeInputValue(value: string) {
  if (!value || value === "待设置") return "";
  return value.replace(" ", "T").slice(0, 16);
}

function fromDateTimeInputValue(value: string) {
  return value ? value.replace("T", " ") : "";
}

export function ProductEditorPage({ products, saveProduct, onNotice }: ProductEditorPageProps) {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = products.find((item) => item.id === id);
  const [form, setForm] = useState<ProductForm>({
    title: editing?.title ?? "",
    category: editing?.category ?? "",
    image: editing?.image ?? "",
    description: editing?.description ?? "",
    startPrice: String(editing?.startPrice ?? ""),
    increment: String(editing?.increment ?? ""),
    capPrice: String(editing?.capPrice ?? ""),
    duration: String(editing?.duration ?? ""),
    autoExtend: String(editing?.autoExtend ?? ""),
    plannedTime: editing?.plannedTime ?? "",
    shipping: "",
    stock: "",
    limit: ""
  });
  const previewCountdown = form.plannedTime ? `计划 ${form.plannedTime}` : `竞拍时长 ${Number(form.duration) || 0} 分钟`;

  function update<K extends keyof ProductForm>(key: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onNotice("图片大小不能超过 5MB", "danger");
      return;
    }
    update("image", URL.createObjectURL(file));
  }

  async function submit() {
    if (await saveProduct(form, editing?.id)) {
      navigate("/auction/products", { state: { tab: "pending" } });
    }
  }

  return (
    <>
      <PageTitle
        eyebrow="竞拍商品"
        title={editing ? "编辑商品" : "新增商品"}
        actions={
          <Button tone="primary" onClick={submit}>保存商品</Button>
        }
      />
      <div className="editor-layout">
        <form className="form-stack" onSubmit={(event: FormEvent) => event.preventDefault()}>
          <section className="panel form-panel product-basic-panel">
            <h2>商品基础信息</h2>
            <label className="field full">
              <span>商品标题 <b>*</b></span>
              <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="请输入商品标题，建议在30字以内" />
            </label>
            <div className="form-grid two product-basic-grid">
              <label className="field">
                <span>商品类目 <b>*</b></span>
                <select value={form.category} onChange={(event) => update("category", event.target.value)} required>
                  <option value="">请选择商品类目</option>
                  <option value="水果生鲜">水果生鲜</option>
                  <option value="海鲜水产">海鲜水产</option>
                  <option value="休闲食品">休闲食品</option>
                </select>
              </label>
              <label className="field">
                <span>商品主图 <b>*</b></span>
                <div className="upload-box">
                  <input type="file" accept="image/png,image/jpeg" onChange={uploadImage} />
                  {form.image ? <img src={form.image} alt="商品预览" /> : <ImagePlus size={28} />}
                  <span>上传图片，支持 JPG/PNG，大小不超过 5MB</span>
                </div>
              </label>
            </div>
            <label className="field full">
              <span>简短描述</span>
              <textarea value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="请输入商品简短描述，帮助买家了解商品卖点" />
            </label>
          </section>

          <section className="panel form-panel">
            <h2>竞拍规则配置</h2>
            <div className="form-grid three">
              <label>起拍价 <b>*</b><input value={form.startPrice} onChange={(event) => update("startPrice", event.target.value)} placeholder="￥ 请输入" /></label>
              <label>加价幅度 <b>*</b><input value={form.increment} onChange={(event) => update("increment", event.target.value)} placeholder="￥ 请输入" /></label>
              <label>封顶价 <b>*</b><input value={form.capPrice} onChange={(event) => update("capPrice", event.target.value)} placeholder="￥ 请输入" /></label>
              <label>竞拍时长 <b>*</b><input value={form.duration} onChange={(event) => update("duration", event.target.value)} placeholder="分钟" /></label>
              <label>
                自动延时 <b>*</b>
                <select value={form.autoExtend} onChange={(event) => update("autoExtend", event.target.value)} required>
                  <option value="">请选择</option>
                  <option value="10">10 秒</option>
                  <option value="20">20 秒</option>
                  <option value="30">30 秒</option>
                </select>
              </label>
              <label>
                开拍时间 <b>*</b>
                <input
                  type="datetime-local"
                  value={toDateTimeInputValue(form.plannedTime)}
                  onChange={(event) => update("plannedTime", fromDateTimeInputValue(event.target.value))}
                />
              </label>
            </div>
          </section>

          <section className="panel form-panel">
            <h2>其他设置</h2>
            <div className="form-grid three">
              <label>
                运费设置 <b>*</b>
                <select value={form.shipping} onChange={(event) => update("shipping", event.target.value as ProductForm["shipping"])} required>
                  <option value="">请选择运费设置</option>
                  <option value="包邮">包邮</option>
                  <option value="不包邮">不包邮</option>
                </select>
              </label>
              <label>库存数量 <b>*</b><input value={form.stock} onChange={(event) => update("stock", event.target.value)} placeholder="请输入" /></label>
              <label>限购数量 <b>*</b><input value={form.limit} onChange={(event) => update("limit", event.target.value)} placeholder="每人最多可拍数量，0为不限购" /></label>
            </div>
          </section>
        </form>

        <aside className="panel preview-card sticky">
          <h2>直播间商品预览</h2>
          <div className="phone-preview">
            <img src={form.image || defaultPreviewImage} alt="直播间商品预览" />
            <div>
              <Tag>即将开始</Tag>
              <h3>{form.title || "商品标题预览"}</h3>
              <span>起拍价</span>
              <strong className="red">{money(Number(form.startPrice) || 0)}</strong>
              <div className="split">
                <p>加价幅度 <b>{money(Number(form.increment) || 0)}</b></p>
                <p>封顶价 <b>{money(Number(form.capPrice) || 0)}</b></p>
              </div>
              <div className="countdown">{previewCountdown}</div>
              <button onClick={() => onNotice("预览中的出价按钮仅展示，不会产生真实出价")}>出价</button>
            </div>
          </div>
          <p className="hint">以上为直播间展示效果预览，实际展示以直播间为准</p>
        </aside>
      </div>
    </>
  );
}
