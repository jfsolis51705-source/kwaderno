"""
Turns a provider's loosely-typed draft (pesos as numbers or strings, assorted date
formats) into the strict Extraction contract, and scores confidence.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from .schema import Extraction, Line



def to_centavos(v: Any) -> int | None:
    """'₱1,234.50' | 1234.5 | '1234' -> 123450. Returns None when not a money value."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(round(float(v) * 100)) if v >= 0 else None
    s = re.sub(r"[₱P$,\s]|php", "", str(v), flags=re.I)
    if not re.fullmatch(r"\d+(\.\d{1,2})?", s):
        return None
    return int(round(float(s) * 100))


def to_qty(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        q = float(str(v).replace(",", ""))
    except ValueError:
        return None
    return round(q, 3) if q > 0 else None


def to_date(v: Any) -> str | None:
    if not v:
        return None
    if isinstance(v, (date, datetime)):
        return v.strftime("%Y-%m-%d")
    s = re.sub(r"\s+", " ", str(v).strip())
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%m-%d-%Y", "%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%d %B %Y", "%m/%d/%y"):
        try:
            d = datetime.strptime(s, fmt).date()
            if 2000 <= d.year <= date.today().year + 1:
                return d.isoformat()
        except ValueError:
            continue
    return None


def _clean(s: Any) -> str | None:
    if s is None:
        return None
    t = re.sub(r"\s+", " ", str(s)).strip()
    return t[:300] or None


def normalize(draft: dict, provider: str, raw: dict | None = None) -> Extraction:
    lines: list[Line] = []
    for item in draft.get("lines") or draft.get("items") or []:
        desc = _clean(item.get("description") or item.get("name"))
        if not desc:
            continue
        qty = to_qty(item.get("quantity"))
        unit = to_centavos(item.get("unit_price", item.get("unitPrice")))
        total = to_centavos(item.get("line_total", item.get("lineTotal", item.get("amount"))))
        # Fill one missing value from the other two.
        if unit is None and total is not None and qty:
            unit = int(round(total / qty))
        if total is None and unit is not None and qty:
            total = int(round(unit * qty))
        conf = item.get("confidence")
        conf = float(conf) if isinstance(conf, (int, float)) and 0 <= conf <= 1 else None
        # Arithmetic check lowers confidence when qty × unit ≠ total.
        if qty and unit is not None and total is not None and abs(qty * unit - total) > max(100, 0.02 * total):
            conf = min(conf if conf is not None else 0.6, 0.4)
        lines.append(Line(description=desc, quantity=qty, unitPriceCentavos=unit, lineTotalCentavos=total, confidence=conf))

    grand = to_centavos(draft.get("grand_total", draft.get("grandTotal", draft.get("total"))))
    overall = draft.get("overall_confidence")
    overall = float(overall) if isinstance(overall, (int, float)) and 0 <= overall <= 1 else None
    line_sum = sum(l.lineTotalCentavos or 0 for l in lines)
    if grand and line_sum:
        # Totals that reconcile (allowing for discount/tax) raise confidence; mismatches lower it.
        disc = to_centavos(draft.get("discount")) or 0
        tax = to_centavos(draft.get("tax")) or 0
        ok = abs(line_sum - disc - grand) <= 100 or abs(line_sum - disc + tax - grand) <= 100
        overall = min(1.0, (overall or 0.7) + 0.1) if ok else min(overall or 0.5, 0.5)

    return Extraction(
        provider=provider,
        supplierName=_clean(draft.get("supplier_name", draft.get("supplierName"))),
        receiptNumber=_clean(draft.get("receipt_number", draft.get("receiptNumber"))),
        purchaseDate=to_date(draft.get("purchase_date", draft.get("purchaseDate"))),
        discountCentavos=to_centavos(draft.get("discount")),
        taxCentavos=to_centavos(draft.get("tax")),
        grandTotalCentavos=grand,
        overallConfidence=round(overall, 3) if overall is not None else None,
        lines=lines,
        raw=raw,
    )
