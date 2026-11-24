"""Deterministic provider for local development and demos. Clearly labelled 'mock'."""
from __future__ import annotations

import hashlib

from ..normalize import normalize
from ..schema import Extraction

SAMPLE = {
    "supplier_name": "Demo Wholesale (mock AI)",
    "receipt_number": None,
    "purchase_date": None,
    "lines": [
        {"description": "MEGA SARDINES TOMATO 155G", "quantity": 24, "unit_price": 20.0, "confidence": 0.93},
        {"description": "NESCAFE CLASSIC 2G X 48", "quantity": 2, "unit_price": 115.0, "confidence": 0.81},
        {"description": "ALASKA EVAP 370ML", "quantity": 12, "unit_price": 33.5, "confidence": 0.9},
    ],
    "overall_confidence": 0.85,
}


class MockProvider:
    name = "mock"

    async def extract(self, data: bytes, mime: str) -> Extraction:
        digest = hashlib.sha256(data).hexdigest()[:12]
        draft = dict(SAMPLE, receipt_number=f"MOCK-{digest[:6].upper()}")
        draft["grand_total"] = sum(l["quantity"] * l["unit_price"] for l in draft["lines"])
        return normalize(draft, self.name, raw={"note": "mock provider — not a real reading", "sha256_prefix": digest})
