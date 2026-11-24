export const peso = (n: number) => "₱" + (n ?? 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const ISSUE_TEXT: Record<string, string> = {
  file_too_small: "File is very small",
  low_resolution: "Low resolution",
  blurry: "Blurry",
};
