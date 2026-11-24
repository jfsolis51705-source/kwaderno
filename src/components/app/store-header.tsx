"use client";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Globe, LogOut, Moon, Plus, Store, Sun, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { api } from "@/lib/api-client";
import { Logo } from "./logo";
import { NAV } from "./nav-items";
import { SyncStatusBadge } from "./sync-status";

interface StoreOption {
  id: string;
  name: string;
  role: string;
}

export function StoreHeader({ user, stores, activeId }: { user: { fullName: string; email: string; isPlatformAdmin?: boolean }; stores: StoreOption[]; activeId: string }) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const active = stores.find((s) => s.id === activeId)!;

  async function switchStore(id: string) {
    try {
      await api(`/api/v1/stores/${id}/select`, { method: "POST" });
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function logout() {
    // Never lose unsynced offline sales by accident.
    const { listOps } = await import("@/lib/offline-queue");
    const unsynced = (await listOps(activeId).catch(() => [])).filter((o) => o.status !== "synced").length;
    if (unsynced && !window.confirm(`${unsynced} offline item(s) on this phone have not synced yet. They stay on this phone and sync when you log in again. Log out anyway?`)) return;
    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => {});
    // Cached pages contain this store's data: clear them so the next person on this phone can't see them.
    if ("caches" in window) await caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="bg-background/90 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex h-16 min-w-0 items-center gap-1 border-b px-2 backdrop-blur sm:gap-2 sm:px-4 lg:px-8">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0">
          <SheetHeader className="border-b">
            <SheetTitle>
              <Logo />
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-3">
            {NAV.map((i) => (
              <Link key={i.href} href={i.href} className="hover:bg-accent flex h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium">
                <i.icon className="size-5" /> {i.label}
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-11 min-w-0 shrink justify-start gap-2 px-2">
            <Store className="text-primary size-5" />
            <span className="truncate font-semibold">{active.name}</span>
            <ChevronDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Your stores</DropdownMenuLabel>
          {stores.map((s) => (
            <DropdownMenuItem key={s.id} onSelect={() => s.id !== activeId && switchStore(s.id)}>
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-muted-foreground text-xs capitalize">{s.role}</span>
              {s.id === activeId && <Check className="text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push("/onboarding?new=1")}>
            <Plus /> Add another store
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <SyncStatusBadge storeId={activeId} />
        <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          <Sun className="hidden size-5 dark:block" />
          <Moon className="size-5 dark:hidden" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account">
              <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full text-sm font-semibold">
                {user.fullName.slice(0, 1).toUpperCase()}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="font-normal">
              <div className="font-medium">{user.fullName}</div>
              <div className="text-muted-foreground text-xs">{user.email}</div>
              <div className="text-muted-foreground mt-1 text-xs capitalize">Role: {active.role}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.isPlatformAdmin && (
              <DropdownMenuItem onSelect={() => router.push("/admin")}>
                <Globe /> KELSON network (admin)
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={logout}>
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
