import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { Pagination } from "../ui/Pagination";
import { Tag } from "../ui/Tag";
import type { ModalName, Notice, Product } from "../../types/merchant";
import { money } from "../../utils/money";

const modalPageSize = 5;

type MerchantModalProps = {
  modal: ModalName;
  product: Product | null;
  orderId: string | null;
  products: Product[];
  close: () => void;
  onNotice: (text: string, tone?: Notice["tone"]) => void;
  addProductToLive: (productId: string) => void;
  shipOrder: (orderId: string, payload: { company: string; trackingNo: string }) => void;
};

export function MerchantModal({ modal, product, orderId, products, close, onNotice, addProductToLive, shipOrder }: MerchantModalProps) {
  const [shipForm, setShipForm] = useState({ company: "", trackingNo: "" });
  const [isClosing, setIsClosing] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setIsClosing(false);
    setPage(1);
  }, [modal]);

  if (!modal) return null;

  const selectedProduct = product ?? products[0];
  const queueProducts = products.filter((item) => ["竞拍中", "待开拍", "已成交"].includes(item.status));
  const addableProducts = products.filter((item) => ["待上架", "待开拍"].includes(item.status));
  const modalProducts = modal === "addProduct" ? addableProducts : queueProducts;
  const pagedModalProducts = modalProducts.slice((page - 1) * modalPageSize, page * modalPageSize);
  const requestClose = () => {
    setIsClosing(true);
    window.setTimeout(close, 160);
  };

  return (
    <div className={isClosing ? "modal-backdrop is-closing" : "modal-backdrop"} onClick={requestClose}>
      <section className="modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={requestClose}>×</button>
        {modal === "comment" && (
          <>
            <h2>评论管理</h2>
            <p>实时评论数据会在接入直播间评论接口后展示。</p>
            <div className="message-list">
              <span>暂无评论数据</span>
            </div>
          </>
        )}
        {modal === "queue" && (
          <>
            <h2>商品队列</h2>
            <p>一个直播间可以关联多个竞拍商品，同一时间只能有一个商品处于竞拍中。</p>
            <div className="modal-list-scroll">
              {queueProducts.length ? pagedModalProducts.map((item) => (
                <div className="queue-row" key={item.id}>
                  <img src={item.image} alt={item.title} />
                  <strong>{item.title}</strong>
                  <Tag>{item.status}</Tag>
                </div>
              )) : <div className="empty-block table-empty">暂无拍品队列数据</div>}
            </div>
            {queueProducts.length > modalPageSize && (
              <Pagination page={page} pageSize={modalPageSize} total={queueProducts.length} onPageChange={setPage} label="件" />
            )}
          </>
        )}
        {modal === "device" && (
          <>
            <h2>设备状态</h2>
            <div className="device-grid">
              <span>暂无设备上报数据</span>
            </div>
          </>
        )}
        {modal === "preview" && selectedProduct && (
          <>
            <h2>商品预览</h2>
            <div className="phone-preview modal-preview">
              <img src={selectedProduct.image} alt={selectedProduct.title} />
              <div>
                <h3>{selectedProduct.title}</h3>
                <span>起拍价</span>
                <strong className="red">{money(selectedProduct.startPrice)}</strong>
                <div className="split">
                  <p>加价幅度 <b>{money(selectedProduct.increment)}</b></p>
                  <p>封顶价 <b>{money(selectedProduct.capPrice)}</b></p>
                </div>
                <div className="countdown">倒计时 --:--:--</div>
                <button onClick={() => onNotice("预览出价不会产生真实出价")}>出价</button>
              </div>
            </div>
          </>
        )}
        {modal === "preview" && !selectedProduct && (
          <>
            <h2>商品预览</h2>
            <div className="empty-block table-empty">暂无商品可预览</div>
          </>
        )}
        {modal === "logistics" && (
          <>
            <h2>物流轨迹</h2>
            <div className="logistics-list">
              <span>
                <Truck size={16} /> 暂无物流轨迹
              </span>
            </div>
          </>
        )}
        {modal === "ship" && (
          <>
            <h2>订单发货</h2>
            <p>填写物流信息后，订单会进入待收货/已完成链路。</p>
            <div className="form-stack modal-form">
              <label>
                物流公司
                <select
                  value={shipForm.company}
                  onChange={(event) => setShipForm((current) => ({ ...current, company: event.target.value }))}
                  required
                >
                  <option value="" disabled>请选择物流公司</option>
                  <option value="顺丰速运">顺丰速运</option>
                  <option value="京东快递">京东快递</option>
                  <option value="中通快递">中通快递</option>
                </select>
              </label>
              <label>
                运单号
                <input
                  value={shipForm.trackingNo}
                  onChange={(event) => setShipForm((current) => ({ ...current, trackingNo: event.target.value }))}
                  placeholder="请输入运单号"
                />
              </label>
              <button
                className="btn primary"
                disabled={!orderId || !shipForm.company || !shipForm.trackingNo.trim()}
                onClick={() => {
                  if (!orderId) return;
                  shipOrder(orderId, { company: shipForm.company, trackingNo: shipForm.trackingNo.trim() });
                  requestClose();
                }}
              >
                确认发货
              </button>
            </div>
          </>
        )}
        {modal === "addProduct" && (
          <>
            <h2>添加竞拍商品</h2>
            <p>选择待上架或已上架商品加入当前直播商品队列。</p>
            <div className="modal-list-scroll">
              {pagedModalProducts
                .map((item) => (
                  <div className="queue-row" key={item.id}>
                    <img src={item.image} alt={item.title} />
                    <strong>{item.title}</strong>
                    <button
                      onClick={() => {
                        addProductToLive(item.id);
                        onNotice("商品已加入直播商品队列");
                        requestClose();
                      }}
                    >
                      加入
                    </button>
                  </div>
                ))}
            </div>
            {addableProducts.length > modalPageSize && (
              <Pagination page={page} pageSize={modalPageSize} total={addableProducts.length} onPageChange={setPage} label="件" />
            )}
          </>
        )}
      </section>
    </div>
  );
}
