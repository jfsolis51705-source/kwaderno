/**
 * Matches free-text receipt lines to catalog products without any paid service:
 * Sørensen–Dice similarity on character bigrams of normalised names, blended
 * with token overlap. Returns a 0..1 confidence; below MIN_SUGGEST nothing is suggested.
 */
export const MIN_SUGGEST = 0.45;

const ABBREV: Record<string, string> = {
  sard: "sardines",
  sdns: "sardines",
  cbeef: "corned beef",
  evap: "evaporada",
  cond: "condensada",
  pc: "",
  pcs: "",
  pck: "pack",
  btl: "bottle",
};

export function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d+)\s*(g|ml|l|kg|gm|grams?)\b/g, "$1$2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => ABBREV[t] ?? t)
    .filter(Boolean)
    .join(" ");
}

function bigrams(s: string) {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

export function similarity(a: string, b: string) {
  const na = normalise(a);
  const nb = normalise(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const A = bigrams(na);
  const B = bigrams(nb);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  const dice = total ? (2 * inter) / total : 0;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const tokens = shared / Math.max(ta.size, tb.size);
  return Math.round((0.6 * dice + 0.4 * tokens) * 1000) / 1000;
}

export function bestMatch<T extends { id: string; name: string; brand?: string | null }>(line: string, products: T[]) {
  let best: { product: T; score: number } | null = null;
  for (const p of products) {
    const score = Math.max(similarity(line, p.name), p.brand ? similarity(line, `${p.brand} ${p.name}`) : 0);
    if (!best || score > best.score) best = { product: p, score };
  }
  return best && best.score >= MIN_SUGGEST ? best : null;
}
