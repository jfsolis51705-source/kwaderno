"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/app/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api } from "@/lib/api-client";

type Member = { id: string; userId: string; fullName: string; email: string; role: "owner" | "manager" | "staff" };

export function MembersCard({ storeId, members, isOwner, currentUserId }: { storeId: string; members: Member[]; isOwner: boolean; currentUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    try {
      await api(`/api/v1/stores/${storeId}/members`, { method: "POST", json: { email: fd.get("email"), role: fd.get("role") } });
      toast.success("Staff member added");
      form.reset();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function changeRole(id: string, role: string) {
    try {
      await api(`/api/v1/stores/${storeId}/members/${id}`, { method: "PATCH", json: { role } });
      toast.success("Role updated");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      router.refresh();
    }
  }
  async function remove(id: string) {
    try {
      await api(`/api/v1/stores/${storeId}/members/${id}`, { method: "DELETE" });
      toast.success("Removed from store");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Owners manage everything. Managers edit products and the store profile. Staff sell, scan and receive stock.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y rounded-lg border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {m.fullName} {m.userId === currentUserId && <span className="text-muted-foreground text-xs">(you)</span>}
                </p>
                <p className="text-muted-foreground truncate text-xs">{m.email}</p>
              </div>
              {isOwner ? (
                <div className="w-32">
                  <NativeSelect aria-label={`Role for ${m.fullName}`} defaultValue={m.role} onChange={(e) => changeRole(m.id, e.target.value)} className="h-9">
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="staff">Staff</option>
                  </NativeSelect>
                </div>
              ) : (
                <Badge variant="secondary" className="capitalize">{m.role}</Badge>
              )}
              {isOwner && m.userId !== currentUserId && (
                <ConfirmationDialog
                  destructive
                  title={`Remove ${m.fullName}?`}
                  description="They will immediately lose access to this store. Their past sales and stock records stay in the history."
                  confirmLabel="Remove"
                  onConfirm={() => remove(m.id)}
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={`Remove ${m.fullName}`}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
            <Input name="email" type="email" required placeholder="Staff email (they must have an account)" aria-label="Staff email" />
            <NativeSelect name="role" defaultValue="staff" aria-label="Role">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
            </NativeSelect>
            <Button type="submit" disabled={busy} className="h-11">
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Add
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
