"use client";
import { ErrorState } from "@/components/app/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState className="mt-10" message={error.digest ? `Reference: ${error.digest}` : "Please try again."} onRetry={reset} />;
}
