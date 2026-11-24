"use client";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Peso input that reports centavos. Keeps the raw text so typing "12." works. */
export function MoneyInput({ id, name, defaultCentavos, onCentavos, invalid, className, ...rest }: {
  id: string;
  name?: string;
  defaultCentavos?: number | null;
  onCentavos?: (c: number | null) => void;
  invalid?: boolean;
} & Omit<React.ComponentProps<"input">, "defaultValue" | "onChange" | "type">) {
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">₱</span>
      <Input
        id={id}
        name={name}
        inputMode="decimal"
        autoComplete="off"
        className={cn("num pl-7", className)}
        aria-invalid={invalid}
        defaultValue={defaultCentavos != null ? (defaultCentavos / 100).toFixed(2) : ""}
        onChange={(e) => {
          const v = e.target.value.replace(/[₱,\s]/g, "");
          onCentavos?.(/^\d+(\.\d{0,2})?$/.test(v) ? Math.round(Number(v) * 100) : null);
        }}
        {...rest}
      />
    </div>
  );
}
