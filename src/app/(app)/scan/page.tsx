import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requireAppContext } from "@/server/auth/current";
import { ScanWorkspace } from "./scan-workspace";

export const metadata: Metadata = { title: "Scan" };

export default async function ScanPage() {
  const { store } = await requireAppContext();
  return (
    <>
      <PageHeader title="Scan" description="Camera, typed barcode, or USB scanner." />
      <ScanWorkspace storeId={store.storeId} />
    </>
  );
}
