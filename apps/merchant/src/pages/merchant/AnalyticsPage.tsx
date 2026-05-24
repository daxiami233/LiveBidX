import { BarChart3 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { PageTitle } from "../../components/ui/PageTitle";
import type { Notice } from "../../types/merchant";

export function AnalyticsPage({ onNotice }: { onNotice: (text: string, tone?: Notice["tone"]) => void }) {
  return (
    <>
      <PageTitle title="数据分析" />
      <section className="panel dashboard-empty-analysis">
        <span>
          <BarChart3 size={34} />
        </span>
        <h3>暂无独立分析数据</h3>
        <p>数据分析页不再展示模拟报表。当前真实经营数据已汇总到仪表盘；产生直播、竞拍和订单后，可在仪表盘查看对应分析。</p>
        <div className="button-row">
          <Button tone="primary" onClick={() => onNotice("请在仪表盘查看真实经营数据")}>查看说明</Button>
        </div>
      </section>
    </>
  );
}
