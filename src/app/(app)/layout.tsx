import { Suspense } from "react";
import { AppSidebar } from "@/components/app/app-sidebar";
import { MobileBottomNavigation } from "@/components/app/mobile-bottom-navigation";
import { StoreHeader } from "@/components/app/store-header";
import { LoadingState } from "@/components/app/states";
import { requireAppContext } from "@/server/auth/current";

/**
 * The frame (nav, layout) is static and prerendered so it can be cached as the
 * PWA app shell. Everything user- or store-specific streams in under Suspense.
 */
export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Suspense fallback={<AppSidebar storeName="" />}>
        <SidebarWithStore />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<div className="h-16 border-b" />}>
          <HeaderWithUser />
        </Suspense>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-28 lg:px-8 lg:pb-10">
          <Suspense fallback={<LoadingState rows={4} />}>{children}</Suspense>
        </main>
      </div>
      <MobileBottomNavigation />
    </div>
  );
}

async function SidebarWithStore() {
  const { active } = await requireAppContext();
  return <AppSidebar storeName={active.name} />;
}

async function HeaderWithUser() {
  const { user, stores, active } = await requireAppContext();
  return <StoreHeader user={{ fullName: user.fullName, email: user.email, isPlatformAdmin: user.isPlatformAdmin }} stores={stores} activeId={active.id} />;
}
