import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAppContext } from "@/server/auth/current";
import { listSyncOperations } from "@/server/services/sync";
import { SyncQueue } from "./sync-queue";

export const metadata: Metadata = { title: "Offline sync" };
const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function SyncPage() {
  const { store } = await requireAppContext();
  const server = (await listSyncOperations(store, 50)) as { operation_id: string; op_type: string; status: string; error_message: string | null; created_at: string; by: string | null }[];
  return (
    <div className="space-y-6">
      <PageHeader title="Offline sync" description="Sales made without internet are kept on the phone and sent automatically when you are back online." />
      <Card>
        <CardHeader><CardTitle>On this phone</CardTitle></CardHeader>
        <CardContent><SyncQueue storeId={store.storeId} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Received by the server</CardTitle><CardDescription>Offline items from all devices in this store.</CardDescription></CardHeader>
        <CardContent>
          {server.length === 0 ? <p className="text-muted-foreground text-sm">None yet.</p> : (
            <ul className="divide-y text-sm">
              {server.map((o) => (
                <li key={o.operation_id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="flex-1">{o.op_type} · {o.by ?? "—"} · {fmt.format(new Date(o.created_at))}{o.error_message ? <span className="text-destructive block text-xs">{o.error_message}</span> : null}</span>
                  <Badge variant={o.status === "applied" ? "success" : o.status === "conflict" ? "destructive" : "secondary"}>{o.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
