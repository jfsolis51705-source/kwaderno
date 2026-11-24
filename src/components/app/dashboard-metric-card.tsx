import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function DashboardMetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "danger";
  href?: string;
}) {
  const body = (
    <Card className={cn("gap-2 px-4 py-4 transition-colors", href && "hover:border-primary/50")}>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span
          className={cn(
            "rounded-md p-1.5",
            tone === "default" && "bg-accent text-accent-foreground",
            tone === "warning" && "bg-warning/20 text-foreground",
            tone === "danger" && "bg-destructive/10 text-destructive",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div className="num truncate text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="text-muted-foreground truncate text-xs">{hint}</div>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
