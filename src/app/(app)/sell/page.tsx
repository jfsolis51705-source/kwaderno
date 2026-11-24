import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { PageHeader } from "@/components/app/page-header";
import { getDb } from "@/db";
import { requireAppContext } from "@/server/auth/current";
import { hasRole } from "@/server/services/stores";
import { SellWorkspace, type SellProduct } from "./sell-workspace";

export const metadata: Metadata = { title: "Sell" };

export default async function SellPage() {
  const { store } = await requireAppContext();
  // Active products, best sellers (last 30 days) first, then by name.
  const r = await getDb().execute<{ id: string; name: string; unit: string; selling_price_centavos: string; quantity: string; category: string | null; barcodes: string[] }>(sql`
    select p.id, p.name, p.unit, p.selling_price_centavos, coalesce(b.quantity,0)::text quantity, c.name category,
      coalesce((select array_agg(pb.barcode) from product_barcodes pb where pb.product_id = p.id), '{}') barcodes
    from products p
    left join inventory_balances b on b.product_id = p.id
    left join categories c on c.id = p.category_id
    left join lateral (
      select sum(si.quantity) sold from sale_items si join sales s on s.id = si.sale_id
      where si.product_id = p.id and s.status = 'completed' and s.occurred_at > now() - interval '30 days'
    ) hot on true
    where p.store_id = ${store.storeId} and p.archived_at is null and p.is_active
    order by coalesce(hot.sold, 0) desc, lower(p.name)
    limit 500`);
  const products: SellProduct[] = r.rows.map((p) => ({
    id: p.id, name: p.name, unit: p.unit, priceCentavos: Number(p.selling_price_centavos), stock: Number(p.quantity), category: p.category, barcodes: p.barcodes,
  }));
  return (
    <>
      <PageHeader title="Sell" description="Tap products, scan, or search. Cash, GCash or utang." />
      <SellWorkspace storeId={store.storeId} products={products} canDiscount={hasRole(store, "manager")} />
    </>
  );
}
