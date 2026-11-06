import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`button ${className}`} {...props} />;
}

export function StatusPill({ children, tone = "muted" }: { children: ReactNode; tone?: "success" | "warning" | "muted" }) {
  return <span className={`status-pill status-${tone}`}><span className="status-dot" aria-hidden="true" />{children}</span>;
}
