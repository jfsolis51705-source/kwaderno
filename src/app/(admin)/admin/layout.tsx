import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, Globe, LayoutDashboard, Map, Store } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { LoadingState } from "@/components/app/states";
import { requirePlatformAdmin } from "@/server/auth/current";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/stores", label: "Stores", icon: Store },
  { href: "/admin/map", label: "Network map", icon: Map },
];

/** KELSON Super-Admin portal: platform-wide view for the system owner. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="bg-sidebar text-sidebar-foreground sticky top-0 z-30">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 lg:px-8">
          <Logo className="text-white" withText={false} />
          <span className="flex items-center gap-1.5 font-semibold text-white"><Globe className="size-4" /> KELSON Network</span>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] tracking-wider uppercase">Super-Admin</span>
          <Link href="/dashboard" className="ml-auto flex items-center gap-1 text-sm opacity-80 hover:opacity-100"><ArrowLeft className="size-4" /> <span className="hidden sm:inline">My store</span></Link>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 lg:px-6" aria-label="Admin">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="flex items-center gap-2 rounded-t-md px-3 py-2 text-sm whitespace-nowrap opacity-85 hover:bg-white/10 hover:opacity-100">
              <n.icon className="size-4" /> {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
        <Suspense fallback={<LoadingState rows={4} />}>
          <AdminGate>{children}</AdminGate>
        </Suspense>
      </main>
    </div>
  );
}

async function AdminGate({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <>{children}</>;
}
