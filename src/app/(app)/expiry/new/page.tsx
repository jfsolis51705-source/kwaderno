import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ExpiryCapture } from "@/components/expiry/expiry-capture";
import { requireAppContext } from "@/server/auth/current";
import { getProduct } from "@/server/services/catalog";

export const metadata: Metadata = { title: "Track expiry" };

export default async function NewExpiryPage({ searchParams }: { searchParams: Promise<{ productId?: string }> }) {
  const { store } = await requireAppContext();
  const { productId } = await searchParams;
  const p = productId ? await getProduct(store, productId).catch(() => null) : null;
  return (
    <>
      <PageHeader title="Track expiry" description="Four quick steps. The photos are kept as proof of the date." />
      <ExpiryCapture storeId={store.storeId} initialProduct={p ? { id: p.id, name: p.name, unit: p.unit } : null} />
    </>
  );
}
