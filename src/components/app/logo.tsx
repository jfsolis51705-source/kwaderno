import { cn } from "@/lib/utils";

/** KWADERNO mark: a notebook page with a scan line. */
export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <rect x="4" y="3" width="22" height="26" rx="4" className="fill-primary" />
        <rect x="8" y="3" width="2" height="26" className="fill-primary-foreground/35" />
        <path d="M13 10h9M13 15h9M13 20h6" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
        <rect x="2" y="23.5" width="28" height="2.5" rx="1.25" className="fill-warning" />
      </svg>
      {withText && <span className="text-lg">KWADERNO</span>}
    </span>
  );
}
