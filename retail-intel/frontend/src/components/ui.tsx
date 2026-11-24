import type { ReactNode } from "react";
import { useApp } from "../state/AppContext";
import type { StockStatus } from "../lib/types";

export function StockChip({ status, qty }: { status: StockStatus; qty?: number }) {
  const cls = status === "out" ? "bg-red-100 text-red-700" : status === "low" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700";
  const label = status === "out" ? "Out of stock" : status === "low" ? "Low" : "OK";
  return <span className={`chip ${cls}`}>{qty != null ? `${qty} · ${label}` : label}</span>;
}

export function OnlineBadge() {
  const { online, queue, syncing, syncNow } = useApp();
  return (
    <div className="flex items-center gap-2">
      <span className={`chip ${online ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"}`} role="status" aria-live="polite">
        <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-slate-500"}`} />
        {online ? "Online" : "Offline"}
      </span>
      <button className="btn btn-sm" onClick={syncNow} disabled={syncing} title="Send queued changes now">
        {syncing ? "Syncing…" : queue.length ? `Sync (${queue.length})` : "Synced"}
      </button>
    </div>
  );
}

export function Toast() {
  const { toastMsg } = useApp();
  if (!toastMsg) return null;
  const cls = toastMsg.tone === "err" ? "bg-red-700" : toastMsg.tone === "warn" ? "bg-amber-600" : "bg-slate-900";
  return <div role="status" className={`fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-lg md:bottom-6 ${cls}`}>{toastMsg.msg}</div>;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "bad" }) {
  return (
    <div className="card">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : ""}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
