import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CalendarClock, Pencil, SlidersHorizontal, History } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { StockAdjustForm } from "@/components/inventory/stock-adjust-form";
import { TXN_LABEL } from "@/components/inventory/txn-labels";
import { ArchiveButton, BarcodeManager, OpenPackButton } from "@/components/products/product-actions";
import { StockBadge } from "@/components/products/stock-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAppContext } from "@/server/auth/current";
import { getProduct } from "@/server/services/catalog";
import { getProductHistory } from "@/server/services/inventory";
import { hasRole } from "@/server/services/stores";
import { orNotFound } from "@/server/page-helpers";
import { formatPeso, formatQty } from "@/lib/money";

export const metadata: Metadata = { title: "Product" };

const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { store } = await requireAppContext();
  const { productId } = await params;
  const [p, history] = await Promise.all([orNotFound(getProduct(store, productId)), orNotFound(getProductHistory(store, productId))]);
  const canManage = hasRole(store, "manager");
  const margin = p.selling_price_centavos - p.purchase_cost_centavos;

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.name}
        description={[p.brand, p.category, p.packaging_description].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            {!p.archived_at && (
              <StockAdjustForm storeId={store.storeId} canManage={canManage} product={{ id: p.id, name: p.name, unit: p.unit, quantity: p.quantity }} trigger={<Button><SlidersHorizontal /> Adjust stock</Button>} />
            )}
            {p.pack_child_id && !p.archived_at && Number(p.quantity) > 0 && (
              <OpenPackButton storeId={store.storeId} productId={p.id} childName={p.pack_child_name!} perPack={Number(p.pack_quantity)} childUnit={p.pack_child_unit!} />
            )}
            {!p.archived_at && <Button asChild variant="outline"><Link href={`/expiry/new?productId=${p.id}`}><CalendarClock /> Track expiry</Link></Button>}
            {canManage && <Button asChild variant="outline"><Link href={`/products/${p.id}/edit`}><Pencil /> Edit</Link></Button>}
            {canManage && <ArchiveButton storeId={store.storeId} productId={p.id} archived={!!p.archived_at} />}
          </>
        }
      />
      {p.archived_at && (
        <Alert variant="warning"><AlertDescription>This product is archived. It is hidden from selling and stock-in.</AlertDescription></Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground text-xs">In stock</p>
              <div className="mt-1"><StockBadge quantity={p.quantity} threshold={p.reorder_threshold} unit={p.unit} /></div>
              <p className="text-muted-foreground mt-1 text-xs">Alert at {formatQty(p.reorder_threshold)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Selling price</p>
              <p className="num text-xl font-semibold">{formatPeso(p.selling_price_centavos)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Cost</p>
              <p className="num text-xl font-semibold">{formatPeso(p.purchase_cost_centavos)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Margin per {p.unit}</p>
              <p className={`num text-xl font-semibold ${margin < 0 ? "text-destructive" : "text-success"}`}>{formatPeso(margin)}</p>
            </div>
            {(p.pack_child_id || p.packsOfThis.length > 0) && (
              <div className="col-span-full flex flex-wrap gap-2 border-t pt-3 text-sm">
                {p.pack_child_id && <Badge variant="outline">Pack of {Number(p.pack_quantity)} × <Link className="underline" href={`/products/${p.pack_child_id}`}>{p.pack_child_name}</Link></Badge>}
                {p.packsOfThis.map((x) => <Badge key={x.id} variant="outline">Sold as pack: <Link className="underline" href={`/products/${x.id}`}>{x.name}</Link> ({Number(x.pack_quantity)})</Badge>)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Barcodes</CardTitle></CardHeader>
          <CardContent><BarcodeManager storeId={store.storeId} productId={p.id} barcodes={p.barcodes} canRemove={canManage} /></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="size-4" /> Stock history</CardTitle></CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <EmptyState title="No movements yet" description="Stock-in, sales and adjustments for this product will be listed here." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden sm:table-cell">When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="hidden sm:table-cell">Reason</TableHead>
                  <TableHead className="hidden md:table-cell">By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => {
                  const up = Number(h.quantity_delta) > 0;
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-muted-foreground hidden text-xs sm:table-cell">{fmt.format(new Date(h.created_at))}</TableCell>
                      <TableCell>
                        {TXN_LABEL[h.type] ?? h.type}
                        <span className="text-muted-foreground block text-xs sm:hidden">{fmt.format(new Date(h.created_at))}</span>
                      </TableCell>
                      <TableCell className={`num text-right font-medium ${up ? "text-success" : "text-destructive"}`}>
                        <span className="inline-flex items-center gap-0.5">{up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{up ? "+" : ""}{formatQty(h.quantity_delta)}</span>
                      </TableCell>
                      <TableCell className="num text-right">{formatQty(h.balance_after)}</TableCell>
                      <TableCell className="text-muted-foreground hidden max-w-60 truncate sm:table-cell">{h.reason ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground hidden md:table-cell">{h.by ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
