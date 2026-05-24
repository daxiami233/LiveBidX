import type { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

export function Button({ children, tone = "secondary", onClick, type = "button", disabled }: ButtonProps) {
  return (
    <button className={`btn ${tone}`} onClick={onClick} type={type} disabled={disabled}>
      {children}
    </button>
  );
}
