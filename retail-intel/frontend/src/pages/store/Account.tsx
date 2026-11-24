import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

export default function Account() {
  const { me, store, storeId, role, logout, queue, toast, online } = useApp();
  const nav = useNavigate();
  const [members, setMembers] = useState<{ id: number; name: string; email: string; role: string }[]>([]);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const load = () => { if (storeId && online) api.members(storeId).then(setMembers).catch(() => setMembers([])); };
  useEffect(load, [storeId, online]);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!storeId) return;
    try { await api.addMember(storeId, { ...f, role: "staff" }); toast(`${f.name} can now log in as staff`); setF({ name: "", email: "", password: "" }); load(); }
    catch (err) { toast((err as Error).message, "err"); }
  };
  const doLogout = async () => {
    if (queue.length && !window.confirm(`${queue.length} change(s) are not synced yet and will be lost. Log out anyway?`)) return;
    await logout(); nav("/login", { replace: true });
  };
  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-bold">Account</h1>
      <div className="card grid gap-1">
        <div className="font-semibold">{me?.user.name}</div><div className="text-sm text-slate-500">{me?.user.email}</div>
        <div className="text-sm">Role in <b>{store?.name}</b>: <span className="chip bg-brand-50 text-brand-700">{role}</span></div>
        <button className="btn-danger mt-2 justify-self-start" onClick={doLogout}>Log out</button>
      </div>
      <div className="card grid gap-3">
        <h2 className="font-semibold">Team — {store?.name}</h2>
        {members.length ? <ul className="divide-y divide-slate-100">{members.map((m) => <li key={m.id} className="flex items-center gap-2 py-2 text-sm"><span className="flex-1">{m.name} <span className="text-slate-500">· {m.email}</span></span><span className="chip bg-slate-100 text-slate-700">{m.role}</span></li>)}</ul> : <Empty>{online ? "Loading…" : "Team list needs a connection."}</Empty>}
        {role === "owner" ? (
          <form className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3" onSubmit={add} aria-label="Add staff">
            <label><span className="label">Staff name</span><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label><span className="label">Email</span><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label><span className="label">Starting password</span><input className="input" type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="8+ characters" /></label>
            <p className="text-xs text-slate-500 sm:col-span-2">Staff can capture photos, scan and adjust stock and build orders. Only owners change prices and the team.</p>
            <button className="btn-primary" type="submit" disabled={!online}>Add staff</button>
          </form>) : null}
      </div>
    </div>
  );
}
