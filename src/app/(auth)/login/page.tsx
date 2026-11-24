import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

async function LoginWithNext({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  // Only allow same-site relative redirects.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const msg = error === "rate" ? "Too many attempts. Please wait a few minutes." : error ? "Incorrect email or password" : null;
  return <LoginForm next={safeNext} initialError={msg} />;
}

export default function LoginPage(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return (
    <Suspense fallback={<LoginForm next="/dashboard" />}>
      <LoginWithNext {...props} />
    </Suspense>
  );
}
