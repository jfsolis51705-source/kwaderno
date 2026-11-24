import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ProductForm } from "@/components/products/product-form";
import { requireAppContext } from "@/server/auth/current";
import { listCategories, listProducts } from "@/server/services/catalog";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ barcode?: string }> }) {
  const { store } = await requireAppContext();
  const { barcode } = await searchParams;
  const [cats, all] = await Promise.all([listCategories(store), listProducts(store, { limit: 200 })]);
  return (
    <>
      <PageHeader title="Add product" description={barcode ? `New barcode ${barcode} — fill in the details from the package.` : "Fill in what you know; you can edit later."} />
      <ProductForm
        storeId={store.storeId}
        categories={cats}
        packCandidates={all.items.map((p) => ({ id: p.id, name: p.name, unit: p.unit }))}
        initialBarcode={barcode && /^[\x20-\x7E]{3,128}$/.test(barcode) ? barcode : undefined}
      />
    </>
  );
}
