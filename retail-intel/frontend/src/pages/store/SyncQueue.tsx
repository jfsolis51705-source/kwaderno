import { when } from "../../lib/format";
import { removeEntry } from "../../lib/offline";
import { useApp } from "../../state/AppContext";
import { Empty } from "../../components/ui";

const OP_TEXT: Record<string, string> = { adjust: "Stock change", product_upsert: "New product", product_patch: "Product edit" };

export default function SyncQueue() {
  const { queue, online, syncNow, syncing, refreshQueue, toast } = useApp();
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2"><div className="flex-1"><h1 className="text-xl font-bold">Sync queue</h1>
        <p className="text-sm text-slate-500">{online ? "Online — changes are sent right away." : "Offline — changes are saved on this phone and sent when you're back online."}</p></div>
        <button className="btn-primary" onClick={syncNow} disabled={syncing || !queue.length}>{syncing ? "Syncing…" : "Sync now"}</button></div>
      {queue.length ? (
        <ul className="card divide-y divide-slate-100" data-testid="queue-list">{queue.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="chip bg-slate-100 text-slate-700">{e.kind === "capture" ? `Photo · ${e.captureKind}` : OP_TEXT[e.type] ?? e.type}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{e.kind === "capture" ? e.fileName : JSON.stringify(e.payload)}</span>
            <span className="text-xs text-slate-500">{when(e.createdAt)}</span>
            {e.error ? <span className="w-full text-xs text-red-700">Needs attention: {e.error} <button className="ml-2 underline" onClick={async () => { await removeEntry(e.id); await refreshQueue(); toast("Removed from queue"); }}>Remove</button></span> : null}
          </li>))}</ul>
      ) : <Empty>Everything is synced.</Empty>}
    </div>
  );
}
