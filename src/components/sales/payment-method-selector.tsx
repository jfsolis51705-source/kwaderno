"use client";
import { Banknote, HandCoins, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaymentMethod = "cash" | "gcash" | "credit";
const OPTIONS: { v: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { v: "cash", label: "Cash", icon: Banknote },
  { v: "gcash", label: "GCash", icon: Smartphone },
  { v: "credit", label: "Utang", icon: HandCoins },
];

export function PaymentMethodSelector({ value, onChange, methods = ["cash", "gcash", "credit"] }: { value: PaymentMethod; onChange: (v: PaymentMethod) => void; methods?: PaymentMethod[] }) {
  const opts = OPTIONS.filter((o) => methods.includes(o.v));
  return (
    <div role="radiogroup" aria-label="Payment method" className={cn("grid gap-2", opts.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cn(
            "flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-medium transition-all",
            value === o.v ? "border-primary bg-primary/10 text-primary ring-primary/30 ring-[3px]" : "bg-card hover:bg-accent",
          )}
        >
          <o.icon className="size-5" />
          {o.label}
        </button>
      ))}
    </div>
  );
}
