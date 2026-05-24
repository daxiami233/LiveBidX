import { Button } from "../../components/ui/Button";
import { PageTitle } from "../../components/ui/PageTitle";
import type { Notice } from "../../types/merchant";

export function SettingsPage({ onNotice }: { onNotice: (text: string, tone?: Notice["tone"]) => void }) {
  return (
    <>
      <PageTitle title="设置" />
      <section className="panel settings-panel">
        <h2>店铺信息设置</h2>
        <div className="form-grid two">
          <label>
            店铺名称
            <input placeholder="请输入店铺名称" />
          </label>
          <label>
            联系方式
            <input placeholder="请输入联系方式" />
          </label>
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>默认竞拍规则设置</h2>
        <div className="form-grid four-cols">
          <label>默认竞拍时长<input placeholder="例如：60分钟" /></label>
          <label>默认加价幅度<input placeholder="例如：￥10" /></label>
          <label>默认自动延时<input placeholder="例如：20秒" /></label>
          <label>支付超时时间<input placeholder="例如：15分钟" /></label>
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>通知设置</h2>
        <div className="switch-grid">
          {["出价通知", "成交通知", "支付通知", "异常通知"].map((item) => (
            <label key={item}>
              {item}
              <input type="checkbox" />
            </label>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <h2>风控设置</h2>
        <div className="form-grid three">
          <label>单用户出价频率限制<input placeholder="例如：3秒/次" /></label>
          <label>重复请求拦截<input placeholder="请选择或输入规则" /></label>
          <label>异常竞拍提醒<input placeholder="请选择或输入规则" /></label>
        </div>
        <div className="button-row">
          <Button tone="primary" onClick={() => onNotice("设置已保存")}>保存设置</Button>
          <Button onClick={() => onNotice("已恢复默认设置", "warning")}>重置默认值</Button>
        </div>
      </section>
    </>
  );
}
