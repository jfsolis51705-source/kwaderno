import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatPeso } from "@/lib/money";
import type { ProductRow } from "@/server/services/catalog";
import { StockBadge } from "./stock-badge";

/** Desktop: table. Phone: tappable cards. Both link to the product page. */
export function ProductTable({ items }: { items: ProductRow[] }) {
  return (
    <>
      <ul className="divide-y rounded-xl border bg-card md:hidden">
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`/products/${p.id}`} className="flex items-center gap-3 p-3 active:bg-muted">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{p.name}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {[p.brand, p.category].filter(Boolean).join(" · ") || "No category"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="num text-sm font-semibold">{formatPeso(p.selling_price_centavos)}</span>
                <StockBadge quantity={p.quantity} threshold={p.reorder_threshold} unit={p.unit} />
              </div>
              <ChevronRight className="text-muted-foreground size-4" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Barcode</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((p) => (
              <TableRow key={p.id} className="relative">
                <TableCell className="max-w-80">
                  <Link href={`/products/${p.id}`} className="font-medium after:absolute after:inset-0 hover:underline">
                    {p.name}
                  </Link>
                  <div className="text-muted-foreground flex items-center gap-2 text-xs">
                    {p.brand}
                    {p.pack_child_name && <Badge variant="outline">Pack of {Number(p.pack_quantity)} {p.pack_child_unit}</Badge>}
                  </div>
                </TableCell>
                <TableCell>{p.category ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="num text-muted-foreground text-xs">{p.barcodes[0] ?? "—"}{p.barcodes.length > 1 && ` +${p.barcodes.length - 1}`}</TableCell>
                <TableCell className="num text-right">{formatPeso(p.purchase_cost_centavos)}</TableCell>
                <TableCell className="num text-right font-medium">{formatPeso(p.selling_price_centavos)}</TableCell>
                <TableCell className="text-right">
                  <StockBadge quantity={p.quantity} threshold={p.reorder_threshold} unit={p.unit} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
