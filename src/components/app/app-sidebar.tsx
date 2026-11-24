"use client";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav-items";
import { Logo } from "./logo";
import { cn } from "@/lib/utils";

function SidebarLinks({ path }: { path?: string }) {
  return (
    <nav className="flex-1 space-y-1 px-3" aria-label="Main">
      {NAV.map((item) => {
        const active = !!path && (path === item.href || path.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "hover:bg-sidebar-accent opacity-85 hover:opacity-100",
            )}
          >
            <item.icon className="size-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ActiveSidebarLinks() {
  return <SidebarLinks path={usePathname()} />;
}

export function AppSidebar({ storeName }: { storeName: string }) {
  return (
    <aside className="bg-sidebar text-sidebar-foreground sticky top-0 hidden h-dvh w-64 shrink-0 flex-col lg:flex">
      <div className="px-5 py-5">
        <Logo className="text-white" />
        <p className="mt-1 truncate pl-10 text-xs opacity-70">{storeName}</p>
      </div>
      <Suspense fallback={<SidebarLinks />}>
        <ActiveSidebarLinks />
      </Suspense>
      <p className="px-5 py-4 text-[11px] opacity-50">Part of the KELSON platform</p>
    </aside>
  );
}
