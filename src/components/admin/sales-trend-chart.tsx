"use client";
import { useState } from "react";
import { formatPeso } from "@/lib/money";

/**
 * Daily network sales, last 30 days. Single series (no legend — the title names it).
 * Bars ≤ 24px with 4px rounded data-ends anchored to the baseline; hairline grid;
 * per-bar hover/focus tooltip; a visually-hidden table carries every value.
 */
export function SalesTrendChart({ data }: { data: { day: string; totalCentavos: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { l: 56, r: 8, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = Math.max(1, ...data.map((d) => d.totalCentavos));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const band = iw / data.length;
  const bw = Math.min(24, band - 2); // 2px surface gap between adjacent bars
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  const short = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" });
  const h = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Bar chart of daily sales across all stores for the last 30 days">
        {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i).map((i) => {
          const v = step * i;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
              <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">{compactPeso(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.l + i * band + (band - bw) / 2;
          const yy = y(d.totalCentavos);
          const hgt = pad.t + ih - yy;
          const r = Math.min(4, hgt);
          return (
            <g key={d.day}>
              {hgt > 0 && (
                <path
                  d={`M${x},${pad.t + ih} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${pad.t + ih} Z`}
                  className={hover === i ? "fill-primary" : "fill-primary/80"}
                />
              )}
              {/* hit target: the whole column, bigger than the mark */}
              <rect
                x={pad.l + i * band}
                y={pad.t}
                width={band}
                height={ih}
                fill="transparent"
                tabIndex={0}
                aria-label={`${short(d.day)}: ${formatPeso(d.totalCentavos)} from ${d.count} sales`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {(i % 7 === 0 && data.length - 1 - i >= 4) || i === data.length - 1 ? (
                <text x={pad.l + i * band + band / 2} y={H - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">{short(d.day)}</text>
              ) : null}
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={pad.t + ih} y2={pad.t + ih} className="stroke-muted-foreground/40" strokeWidth={1} />
      </svg>
      {h && hover != null && (
        <div
          role="status"
          className="bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 rounded-md border px-3 py-2 text-xs shadow-md"
          style={{ left: `clamp(0px, calc(${((pad.l + hover * band + band / 2) / W) * 100}% - 70px), calc(100% - 150px))` }}
        >
          <p className="font-medium">{new Date(h.day + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}</p>
          <p className="num">{formatPeso(h.totalCentavos)} · {h.count} sale{h.count === 1 ? "" : "s"}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>Daily sales, last 30 days</caption>
        <thead><tr><th>Date</th><th>Sales</th><th>Transactions</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.day}><td>{d.day}</td><td>{formatPeso(d.totalCentavos)}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function compactPeso(c: number) {
  const v = c / 100;
  return v >= 1_000_000 ? `₱${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `₱${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : `₱${Math.round(v)}`;
}
