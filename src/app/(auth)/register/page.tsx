"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/forms/field";
import { api, ApiError } from "@/lib/api-client";
import { registerSchema } from "@/lib/validation";

export default function RegisterPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const values = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api("/api/v1/auth/register", { method: "POST", json: parsed.data });
      router.replace("/onboarding");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors());
        setFormError(err.message);
      } else setFormError("Could not create your account");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Create your account</h1>
        <p className="text-muted-foreground text-sm">Free for sari-sari stores. Takes one minute.</p>
      </div>
      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={onSubmit} method="post" action="/api/v1/auth/register" className="space-y-4" noValidate>
        <Field id="fullName" label="Your name" error={errors.fullName}>
          <Input id="fullName" name="fullName" autoComplete="name" aria-invalid={!!errors.fullName} />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} />
        </Field>
        <Field id="phone" label="Mobile number (optional)" error={errors.phone} hint="e.g. 09171234567">
          <Input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" aria-invalid={!!errors.phone} />
        </Field>
        <Field id="password" label="Password" error={errors.password} hint="At least 8 characters">
          <Input id="password" name="password" type="password" autoComplete="new-password" aria-invalid={!!errors.password} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} Create account
        </Button>
      </form>
      <p className="text-muted-foreground text-center text-sm">
        Already have an account?{" "}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
