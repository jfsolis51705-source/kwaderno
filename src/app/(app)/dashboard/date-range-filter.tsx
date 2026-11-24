"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function shift(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function DateRangeFilter({ from, to, today }: { from: string; to: string; today: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const go = (f: string, t: string) => {
    const p = new URLSearchParams(sp);
    p.set("from", f);
    p.set("to", t);
    router.push(`?${p.toString()}`);
  };
  const presets = [
    { label: "Today", f: today, t: today },
    { label: "Yesterday", f: shift(today, -1), t: shift(today, -1) },
    { label: "7 days", f: shift(today, -6), t: today },
    { label: "30 days", f: shift(today, -29), t: today },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <Button key={p.label} size="sm" variant={from === p.f && to === p.t ? "default" : "outline"} onClick={() => go(p.f, p.t)}>
          {p.label}
        </Button>
      ))}
      <div className="flex items-center gap-1">
        <Input aria-label="From date" type="date" className="h-8 w-36" value={from} max={today} onChange={(e) => e.target.value && go(e.target.value, to)} />
        <span className="text-muted-foreground text-xs">to</span>
        <Input aria-label="To date" type="date" className="h-8 w-36" value={to} max={today} onChange={(e) => e.target.value && go(from, e.target.value)} />
      </div>
    </div>
  );
}
