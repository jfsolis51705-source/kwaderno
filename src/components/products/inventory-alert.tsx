import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function InventoryAlert({ low, out }: { low: number; out: number }) {
  if (!low && !out) return null;
  return (
    <Alert variant="warning">
      <AlertTriangle />
      <AlertTitle>Stock needs attention</AlertTitle>
      <AlertDescription>
        <p>
          {out > 0 && <><Link href="/products?filter=out" className="font-medium underline">{out} out of stock</Link>{low > out ? " · " : ""}</>}
          {low > out && <Link href="/products?filter=low" className="font-medium underline">{low - out} running low</Link>}
        </p>
      </AlertDescription>
    </Alert>
  );
}
