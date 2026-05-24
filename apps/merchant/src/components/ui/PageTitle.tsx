import type { ReactNode } from "react";

type PageTitleProps = {
  eyebrow?: string;
  title: string;
  actions?: ReactNode;
};

export function PageTitle({ eyebrow, title, actions }: PageTitleProps) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <span>{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="title-actions">{actions}</div>}
    </div>
  );
}
