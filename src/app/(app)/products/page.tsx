import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/states";
import { InventoryAlert } from "@/components/products/inventory-alert";
import { ProductTable } from "@/components/products/product-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { requireAppContext } from "@/server/auth/current";
import { listCategories, listProducts } from "@/server/services/catalog";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Products & Stock" };

const FILTERS = [
  { v: "all", label: "All" },
  { v: "low", label: "Low stock" },
  { v: "out", label: "Out of stock" },
  { v: "archived", label: "Archived" },
] as const;

type SP = { q?: string; categoryId?: string; filter?: string; page?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { store } = await requireAppContext();
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.v === sp.filter) ? sp.filter! : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = 50;
  const categoryId = sp.categoryId && /^[0-9a-f-]{36}$/i.test(sp.categoryId) ? sp.categoryId : undefined;
  const [list, cats, low, out] = await Promise.all([
    listProducts(store, { q: sp.q || undefined, categoryId, filter, limit, offset: (page - 1) * limit }),
    listCategories(store),
    listProducts(store, { filter: "low", limit: 1 }),
    listProducts(store, { filter: "out", limit: 1 }),
  ]);
  const href = (o: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ q: sp.q, categoryId, filter, ...o }).filter(([, v]) => v && v !== "all") as [string, string][]);
    return `/products${p.size ? `?${p}` : ""}`;
  };
  const pages = Math.ceil(list.total / limit);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products & Stock"
        description={`${list.total} product${list.total === 1 ? "" : "s"}${filter !== "all" ? ` · ${FILTERS.find((f) => f.v === filter)!.label.toLowerCase()}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline"><Link href="/stock-in">Stock-in</Link></Button>
            <Button asChild><Link href="/products/new"><Plus /> Add product</Link></Button>
          </>
        }
      />
      <InventoryAlert low={low.total} out={out.total} />

      <form className="grid gap-2 sm:grid-cols-[1fr_14rem_auto]" action="/products">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input name="q" defaultValue={sp.q} placeholder="Search name, brand, SKU or barcode" className="pl-9" aria-label="Search products" />
        </div>
        <NativeSelect name="categoryId" defaultValue={categoryId ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <Button type="submit" variant="secondary" className="h-11">Search</Button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <Link key={f.v} href={href({ filter: f.v, page: undefined })} className={cn("rounded-full border px-3 py-1.5 text-sm whitespace-nowrap", filter === f.v ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}>
            {f.label}
          </Link>
        ))}
      </div>

      {list.items.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={sp.q || categoryId || filter !== "all" ? "No matching products" : "No products yet"}
          description={sp.q || categoryId || filter !== "all" ? "Try a different search or filter." : "Add your first product, or scan its barcode to start."}
          action={<Button asChild><Link href="/products/new"><Plus /> Add product</Link></Button>}
        />
      ) : (
        <ProductTable items={list.items} />
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <Button asChild variant="outline" size="sm" className={cn(page <= 1 && "pointer-events-none opacity-50")}><Link href={href({ page: String(page - 1) })}>Previous</Link></Button>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <Button asChild variant="outline" size="sm" className={cn(page >= pages && "pointer-events-none opacity-50")}><Link href={href({ page: String(page + 1) })}>Next</Link></Button>
        </nav>
      )}
    </div>
  );
}
