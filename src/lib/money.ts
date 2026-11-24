/** Money helpers. All amounts travel as integer centavos; only the UI formats pesos. */
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", minimumFractionDigits: 2 });

export function formatPeso(centavos: number | null | undefined) {
  return peso.format((centavos ?? 0) / 100);
}

/** Parses "1,234.50" / "₱12" into centavos. Returns null if not a valid amount. */
export function parsePesoToCentavos(input: string): number | null {
  const cleaned = input.replace(/[₱,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function formatQty(q: string | number | null | undefined) {
  const n = Number(q ?? 0);
  return Number.isInteger(n) ? n.toLocaleString("en-PH") : n.toLocaleString("en-PH", { maximumFractionDigits: 3 });
}
