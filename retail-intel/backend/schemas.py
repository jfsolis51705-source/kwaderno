from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["shelf", "receipt", "ledger"]


class StoreIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    barangay: str | None = Field(default=None, max_length=80)
    city: str | None = Field(default=None, max_length=80)
    owner_name: str | None = Field(default=None, max_length=120)


class ProductIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=160)
    brand: str | None = Field(default=None, max_length=80)
    variant: str | None = Field(default=None, max_length=80)
    barcode: str | None = Field(default=None, max_length=32)
    price: float = Field(default=0, ge=0, le=1_000_000)
    cost: float = Field(default=0, ge=0, le=1_000_000)
    reorder_level: int = Field(default=5, ge=0, le=100_000)
    qty_on_hand: int = Field(default=0, ge=0, le=1_000_000)


class ProductPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    brand: str | None = Field(default=None, max_length=80)
    variant: str | None = Field(default=None, max_length=80)
    barcode: str | None = Field(default=None, max_length=32)
    price: float | None = Field(default=None, ge=0, le=1_000_000)
    cost: float | None = Field(default=None, ge=0, le=1_000_000)
    reorder_level: int | None = Field(default=None, ge=0, le=100_000)


class CaptureItem(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    name: str | None = Field(default=None, max_length=160)
    brand: str | None = Field(default="", max_length=80)
    variant: str | None = Field(default="", max_length=80)
    qty: int = Field(ge=0, le=100_000)
    unit_price: float = Field(default=0, ge=0, le=1_000_000)
    confidence: float = Field(default=1.0, ge=0, le=1)


class ConfirmCapture(BaseModel):
    items: list[CaptureItem] = Field(max_length=200)
    award_low_quality: bool = False  # reviewer override: award points even though quality checks flagged the photo


class AdjustIn(BaseModel):
    store_id: int
    sku: str | None = None
    barcode: str | None = None
    delta: int = Field(ge=-100_000, le=100_000)
    reason: Literal["barcode", "manual"] = "manual"


class OrderDraftIn(BaseModel):
    store_id: int
    distributor: str = Field(default="Super8", max_length=60)


class OrderLineIn(BaseModel):
    product_id: int
    qty: int = Field(ge=0, le=100_000)


class OrderPatch(BaseModel):
    distributor: str | None = Field(default=None, max_length=60)
    note: str | None = Field(default=None, max_length=500)
    lines: list[OrderLineIn] | None = Field(default=None, max_length=300)


class OrderStatusIn(BaseModel):
    status: Literal["submitted", "fulfilled", "cancelled"]


class SyncOpIn(BaseModel):
    op_id: str = Field(min_length=8, max_length=64)
    type: Literal["adjust", "product_upsert", "product_patch"]
    payload: dict


class SyncIn(BaseModel):
    store_id: int
    ops: list[SyncOpIn] = Field(max_length=500)
