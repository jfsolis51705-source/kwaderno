from __future__ import annotations

from typing import Protocol

from ..schema import Extraction

PROMPT = """You read Philippine supplier receipts and invoices (wholesalers such as Super8, Puregold, Suy Sing, sari-sari suppliers).
Return ONLY JSON with this shape:
{"supplier_name": str|null, "receipt_number": str|null, "purchase_date": "YYYY-MM-DD"|null,
 "lines": [{"description": str, "quantity": number|null, "unit_price": number|null, "line_total": number|null, "confidence": 0..1}],
 "discount": number|null, "tax": number|null, "grand_total": number|null, "overall_confidence": 0..1}
Rules: amounts are in pesos as plain numbers (no symbols). Copy product descriptions as printed.
Do not invent values; use null when unreadable. One entry per purchased product line; skip subtotal/VAT/change lines."""


class Provider(Protocol):
    name: str

    async def extract(self, data: bytes, mime: str) -> Extraction: ...


class ProviderError(Exception):
    """Raised for provider/configuration failures; returned to the app as 502/503."""
