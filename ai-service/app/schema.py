"""Output contract shared with the Next.js app (src/server/ai/extractor.ts). Money = integer centavos."""
from __future__ import annotations

from pydantic import BaseModel, Field


class Line(BaseModel):
    description: str = Field(min_length=1)
    quantity: float | None = Field(default=None, gt=0)
    unitPriceCentavos: int | None = Field(default=None, ge=0)
    lineTotalCentavos: int | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)


class Extraction(BaseModel):
    provider: str
    supplierName: str | None = None
    receiptNumber: str | None = None
    purchaseDate: str | None = None  # YYYY-MM-DD
    discountCentavos: int | None = None
    taxCentavos: int | None = None
    grandTotalCentavos: int | None = None
    overallConfidence: float | None = Field(default=None, ge=0, le=1)
    lines: list[Line]
    raw: dict | None = None
