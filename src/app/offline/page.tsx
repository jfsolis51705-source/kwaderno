import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Offline" };

/** Shown by the service worker when a page that was never opened before is requested offline. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-5 p-6 text-center">
      <Logo />
      <CloudOff className="text-muted-foreground size-10" />
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-muted-foreground text-sm">This page hasn&apos;t been saved on your phone yet. Pages you opened before — like Sell — still work, and sales are kept until you are back online.</p>
      </div>
      <Button asChild size="lg"><Link href="/sell">Go to Sell</Link></Button>
    </main>
  );
}
