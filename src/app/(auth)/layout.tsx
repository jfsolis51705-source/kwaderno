import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { getCurrentUser } from "@/server/auth/current";

async function RedirectIfLoggedIn() {
  if (await getCurrentUser()) redirect("/dashboard");
  return null;
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="bg-sidebar text-sidebar-foreground relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <Logo className="text-white" />
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-3xl font-semibold text-white">Ang kwaderno ng tindahan mo, ngayon digital na.</h2>
          <p className="opacity-80">
            Track stock, sales and utang from your phone — with barcode and receipt scanning that does the typing for you.
          </p>
        </div>
        <p className="text-xs opacity-50">KWADERNO · KELSON AI Operating System</p>
        <div aria-hidden className="bg-primary/25 absolute -right-24 -bottom-24 size-96 rounded-full blur-3xl" />
      </section>
      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <Suspense>
            <RedirectIfLoggedIn />
          </Suspense>
          <Logo className="lg:hidden" />
          <Suspense>{children}</Suspense>
        </div>
      </section>
    </main>
  );
}
