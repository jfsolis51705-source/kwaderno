import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { ProductForm } from "@/components/products/product-form";
import { requireAppContext } from "@/server/auth/current";
import { getProduct, listCategories, listProducts } from "@/server/services/catalog";
import { hasRole } from "@/server/services/stores";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { store } = await requireAppContext();
  const { productId } = await params;
  if (!hasRole(store, "manager")) redirect(`/products/${productId}`);
  const [p, cats, all] = await Promise.all([getProduct(store, productId), listCategories(store), listProducts(store, { limit: 200 })]);
  return (
    <>
      <PageHeader title="Edit product" description={p.name} />
      <ProductForm
        storeId={store.storeId}
        categories={cats}
        packCandidates={all.items.map((x) => ({ id: x.id, name: x.name, unit: x.unit }))}
        initial={{
          id: p.id, name: p.name, brand: p.brand, sku: p.sku, category: p.category, unit: p.unit, packagingDescription: p.packaging_description,
          purchaseCostCentavos: p.purchase_cost_centavos, sellingPriceCentavos: p.selling_price_centavos, reorderThreshold: p.reorder_threshold,
          packChildId: p.pack_child_id, packQuantity: p.pack_quantity, barcodes: p.barcodes,
        }}
      />
    </>
  );
}
