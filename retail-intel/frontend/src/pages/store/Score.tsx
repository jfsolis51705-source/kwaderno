import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { peso, when } from "../../lib/format";
import type { Cashflow } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

const BAND: Record<Cashflow["band"], string> = { Strong: "text-emerald-700", Fair: "text-amber-700", Building: "text-slate-600" };

export default function Score() {
  const { storeId, role, online } = useApp();
  const [cf, setCf] = useState<Cashflow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (storeId && online && role !== "staff") api.cashflow(storeId).then(setCf).catch((e) => setErr((e as Error).message)); }, [storeId, online, role]);
  if (role === "staff") return <Empty>The business score is visible to store owners only.</Empty>;
  if (!online) return <Empty>The business score needs a connection.</Empty>;
  if (err) return <Empty>{err}</Empty>;
  if (!cf) return <Empty>Calculating…</Empty>;
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2"><Link to="/store/rewards" className="btn btn-sm">‹ Rewards</Link><h1 className="text-xl font-bold">Business score</h1></div>
      <div className="card grid gap-2 text-center">
        <div className="text-sm text-slate-500">Cash-flow readiness</div>
        <div className="text-5xl font-bold tabular-nums" data-testid="cashflow-score">{cf.score}<span className="text-xl text-slate-400">/100</span></div>
        <div className={`font-semibold ${BAND[cf.band]}`}>{cf.band}</div>
        <div className="mx-auto mt-1 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${cf.score}%` }} /></div>
        <p className="text-xs text-slate-500">Updated {when(cf.computed_at)} · avg sales {peso(cf.metrics.avg_daily_sales)}/day on recorded days · stock {peso(cf.metrics.stock_value)}</p>
      </div>
      <div className="card grid gap-3">
        <h2 className="font-semibold">What it's made of</h2>
        {cf.factors.map((f) => (
          <div key={f.key}>
            <div className="flex justify-between text-sm"><span className="font-medium">{f.label}</span><span className="tabular-nums text-slate-600">{f.points} / {f.weight}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${f.score * 100}%` }} /></div>
            <div className="mt-0.5 text-xs text-slate-500">{f.detail}</div>
          </div>))}
      </div>
      {cf.improve.length ? <div className="card"><h2 className="mb-1 font-semibold">How to raise it</h2><ul className="list-disc pl-5 text-sm text-slate-700">{cf.improve.map((x) => <li key={x}>{x}{x.startsWith("Sales recorded") ? " — snap your ledger page every day (Today's check-in)" : x.startsWith("Restocks") ? " — order through Restock" : x.startsWith("Clear") ? " — retake blurry photos, never reuse old ones" : ""}</li>)}</ul></div> : null}
      <p className="rounded-lg bg-slate-100 p-3 text-xs text-slate-600">{cf.disclaimer}</p>
    </div>
  );
}
