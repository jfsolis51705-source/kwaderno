import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { kv } from "../../lib/idb";
import { when } from "../../lib/format";
import type { Rewards } from "../../lib/types";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

export default function RewardsPage() {
  const { storeId, role } = useApp();
  const [r, setR] = useState<Rewards | null>(null);
  useEffect(() => {
    if (!storeId) return;
    api.rewards(storeId).then((x) => { setR(x); kv.set(`rewards:${storeId}`, x); }).catch(async () => setR((await kv.get<Rewards>(`rewards:${storeId}`)) ?? null));
  }, [storeId]);
  if (!r) return <Empty>Loading rewards…</Empty>;
  const next = r.redemptions.find((x) => !x.can_redeem);
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-bold">Rewards</h1>
      <div className="card bg-gradient-to-br from-brand-500 to-brand-700 text-white">
        <div className="text-sm opacity-80">Points balance</div>
        <div className="text-4xl font-bold tabular-nums" data-testid="points-balance">{r.balance}</div>
        <div className="mt-1 text-sm opacity-90">Earn {r.points_per_capture.shelf} per verified shelf photo, {r.points_per_capture.receipt} per receipt, {r.points_per_capture.ledger} per ledger page. Duplicate or blurry photos don't earn points.</div>
        {next ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/30"><div className="h-full bg-white" style={{ width: `${Math.min(100, (r.balance / next.points) * 100)}%` }} /></div> : null}
        {next ? <div className="mt-1 text-xs opacity-90">{next.points_short} more points to “{next.label}”</div> : null}
      </div>
      {role !== "staff" ? <Link to="/store/score" className="card flex items-center gap-3 hover:border-brand-500"><span className="text-2xl">📈</span><span className="flex-1"><span className="block font-semibold">Business score</span><span className="text-xs text-slate-500">Cash-flow readiness from your photos and stock records — and how to raise it</span></span><span aria-hidden>›</span></Link> : null}
      <div className="card"><h2 className="mb-2 font-semibold">Redeem (preview)</h2>
        <ul className="divide-y divide-slate-100">{r.redemptions.map((x) => (
          <li key={x.id} className="flex items-center gap-3 py-2"><div className="flex-1 text-sm font-medium">{x.label}</div><div className="text-sm tabular-nums text-slate-500">{x.points} pts</div>
            <span className={`chip ${x.can_redeem ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{x.can_redeem ? "Available" : `${x.points_short} to go`}</span></li>))}</ul>
        <p className="mt-2 text-xs text-slate-500">Preview only — redemption is handled by KELSON operations.</p></div>
      <div className="card"><h2 className="mb-2 font-semibold">History</h2>
        {r.history.length ? <ul className="divide-y divide-slate-100">{r.history.map((h) => (
          <li key={h.id} className="flex items-center gap-3 py-2 text-sm"><span className="flex-1">{h.reason}</span><span className="text-xs text-slate-500">{when(h.created_at)}</span><span className="font-semibold text-emerald-700">+{h.points}</span></li>))}</ul> : <Empty>No points yet — confirm a clear shelf photo to earn your first.</Empty>}</div>
    </div>
  );
}
