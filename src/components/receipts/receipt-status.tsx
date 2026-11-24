import { Badge } from "@/components/ui/badge";

const MAP: Record<string, { label: string; v: "secondary" | "warning" | "success" | "destructive" | "outline" }> = {
  uploaded: { label: "Uploaded", v: "secondary" },
  queued: { label: "Waiting", v: "secondary" },
  processing: { label: "Reading…", v: "secondary" },
  pending_review: { label: "Needs review", v: "warning" },
  confirmed: { label: "Confirmed", v: "success" },
  failed: { label: "Couldn't read", v: "destructive" },
  rejected: { label: "Rejected", v: "outline" },
};

export function ReceiptStatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, v: "outline" as const };
  return <Badge variant={s.v}>{s.label}</Badge>;
}
