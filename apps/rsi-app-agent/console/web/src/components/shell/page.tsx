"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Page title row: title, one-line purpose, actions on the right. */
export function PageHeader({ title, description, actions, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {title && <h1 className="text-lg font-semibold tracking-tight">{title}</h1>}
        {description && <p className={cn("max-w-3xl text-muted-foreground", title ? "mt-0.5" : "text-[13px]")}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border bg-card", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 className="font-medium">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pill({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium", className)}>{children}</span>;
}

export function Loading() {
  return <div className="p-8 text-muted-foreground">加载中…</div>;
}

export function Failure({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return <div className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error.message}</div>;
}
