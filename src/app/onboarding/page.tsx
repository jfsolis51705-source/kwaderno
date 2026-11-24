import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoadingState } from "@/components/app/states";
import { Logo } from "@/components/app/logo";
import { requireUser } from "@/server/auth/current";
import { listMyStores } from "@/server/services/stores";
import { StoreSetupForm } from "./store-setup-form";

export const metadata: Metadata = { title: "Set up your store" };

export default function OnboardingPage(props: { searchParams: Promise<{ new?: string }> }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-5 py-8">
      <Logo />
      <Suspense fallback={<LoadingState />}>
        <Onboarding {...props} />
      </Suspense>
    </main>
  );
}

async function Onboarding({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser();
  const { new: addAnother } = await searchParams;
  const stores = await listMyStores(user.id);
  if (stores.length && !addAnother) redirect("/dashboard");
  return (
    <>
      <div className="space-y-1">
        <p className="text-primary text-sm font-medium">Step 1 of 1</p>
        <h1 className="text-2xl font-semibold">Tell us about your store</h1>
        <p className="text-muted-foreground">Hi {user.fullName.split(" ")[0]}! You can change these details later in Settings.</p>
      </div>
      <StoreSetupForm ownerName={user.fullName} />
    </>
  );
}
