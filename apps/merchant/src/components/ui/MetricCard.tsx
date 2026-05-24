import type { ReactNode } from "react";

type MetricCardProps = {
  icon: ReactNode;
  title: string;
  value: string;
  sub: ReactNode;
  tone?: string;
};

export function MetricCard({ icon, title, value, sub, tone = "blue" }: MetricCardProps) {
  return (
    <section className="metric-card">
      <span className={`metric-icon ${tone}`}>{icon}</span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <p>{sub}</p>
      </div>
    </section>
  );
}
