"use client";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav-items";
import { cn } from "@/lib/utils";

function BottomLinks({ path }: { path?: string }) {
  const items = NAV.filter((i) => i.mobile);
  return (
    <ul className="mx-auto grid max-w-lg grid-cols-5">
      {items.map((item) => {
        const active = !!path && (path === item.href || path.startsWith(item.href + "/"));
        const primary = "primary" in item && item.primary;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
            >
              {primary ? (
                <span className="bg-primary text-primary-foreground -mt-6 flex size-14 items-center justify-center rounded-full shadow-lg ring-4 ring-background">
                  <item.icon className="size-6" />
                </span>
              ) : (
                <item.icon className="size-6" />
              )}
              <span>{item.short}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ActiveBottomLinks() {
  return <BottomLinks path={usePathname()} />;
}

/** Thumb-reachable bottom bar for phones/tablets. The centre Scan button is the main action. */
export function MobileBottomNavigation() {
  return (
    <nav
      aria-label="Main"
      className="bg-card/95 supports-[backdrop-filter]:bg-card/80 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Suspense fallback={<BottomLinks />}>
        <ActiveBottomLinks />
      </Suspense>
    </nav>
  );
}
