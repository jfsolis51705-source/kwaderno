import { Badge } from "@/components/ui/badge";
import { formatQty } from "@/lib/money";

export function StockBadge({ quantity, threshold, unit }: { quantity: string | number; threshold: string | number; unit: string }) {
  const q = Number(quantity);
  const v = q <= 0 ? "destructive" : q <= Number(threshold) ? "warning" : "secondary";
  return (
    <Badge variant={v} className="num">
      {formatQty(q)} {unit}
    </Badge>
  );
}
