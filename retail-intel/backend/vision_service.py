"""Pluggable vision extraction for shelf photos, purchase receipts and handwritten sales ledgers.

No model is trained here. Providers:
- "mock"   (default): deterministic, offline extraction seeded by the image hash, so the whole app and the
                      tests run with zero keys. Same image -> same items.
- "openai_compatible": any OpenAI-style /chat/completions endpoint that accepts images
                      (OpenAI, Gemini's OpenAI-compatible API, Qwen2.5/3-VL or InternVL served by vLLM, etc.).
- "anthropic":        Claude Messages API with image input.

Select with VISION_PROVIDER; real providers read VISION_API_KEY / VISION_MODEL / VISION_API_BASE.
If a real provider is selected but not configured, get_provider() falls back to mock and says so in `name`.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import re
from dataclasses import asdict, dataclass, field
from typing import Protocol

import httpx

KINDS = ("shelf", "receipt", "ledger")


@dataclass
class ExtractedItem:
    sku: str
    brand: str
    variant: str
    qty: int
    unit_price: float  # pesos; 0 when not visible (e.g. shelf photos without price tags)
    confidence: float  # 0..1
    name: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class ExtractionResult:
    provider: str
    items: list[ExtractedItem] = field(default_factory=list)
    note: str | None = None


class VisionProvider(Protocol):
    name: str

    def extract(self, image: bytes, kind: str, catalog: list[dict]) -> ExtractionResult: ...


# A small reference catalog of common sari-sari SKUs used by the mock provider when the store catalog is thin.
REFERENCE_SKUS: list[dict] = [
    {"sku": "LM-PC-ORIG-60", "name": "Lucky Me Pancit Canton Original 60g", "brand": "Lucky Me", "variant": "Original 60g", "price": 18.0},
    {"sku": "LM-PC-CHILI-60", "name": "Lucky Me Pancit Canton Chilimansi 60g", "brand": "Lucky Me", "variant": "Chilimansi 60g", "price": 18.0},
    {"sku": "555-SARD-155", "name": "555 Sardines in Tomato Sauce 155g", "brand": "555", "variant": "Tomato Sauce 155g", "price": 24.0},
    {"sku": "MEGA-SARD-155", "name": "Mega Sardines Tomato 155g", "brand": "Mega", "variant": "Tomato 155g", "price": 23.0},
    {"sku": "ARG-CB-150", "name": "Argentina Corned Beef 150g", "brand": "Argentina", "variant": "150g", "price": 42.0},
    {"sku": "CEN-TUNA-155", "name": "Century Tuna Flakes in Oil 155g", "brand": "Century", "variant": "Flakes in Oil 155g", "price": 40.0},
    {"sku": "NES-CLASSIC-2", "name": "Nescafé Classic 2g", "brand": "Nescafé", "variant": "Classic 2g", "price": 3.0},
    {"sku": "KOP-BLANCA-TP", "name": "Kopiko Blanca Twin Pack", "brand": "Kopiko", "variant": "Blanca Twin Pack", "price": 14.0},
    {"sku": "MILO-24", "name": "Milo 24g", "brand": "Milo", "variant": "24g", "price": 12.0},
    {"sku": "BEAR-33", "name": "Bear Brand Powdered Milk 33g", "brand": "Bear Brand", "variant": "33g", "price": 15.0},
    {"sku": "COKE-MISMO", "name": "Coca-Cola Mismo 290ml", "brand": "Coca-Cola", "variant": "Mismo 290ml", "price": 20.0},
    {"sku": "ROYAL-MISMO", "name": "Royal Tru-Orange Mismo 290ml", "brand": "Royal", "variant": "Mismo 290ml", "price": 20.0},
    {"sku": "C2-APPLE-230", "name": "C2 Apple Green Tea 230ml", "brand": "C2", "variant": "Apple 230ml", "price": 18.0},
    {"sku": "PIATTOS-40", "name": "Piattos Cheese 40g", "brand": "Piattos", "variant": "Cheese 40g", "price": 20.0},
    {"sku": "SURF-65", "name": "Surf Powder Cherry Blossom 65g", "brand": "Surf", "variant": "Cherry Blossom 65g", "price": 9.0},
    {"sku": "DOWNY-24", "name": "Downy Garden Bloom 24ml", "brand": "Downy", "variant": "Garden Bloom 24ml", "price": 8.0},
    {"sku": "SAFEG-60", "name": "Safeguard Pure White 60g", "brand": "Safeguard", "variant": "Pure White 60g", "price": 35.0},
    {"sku": "COLG-22", "name": "Colgate Toothpaste Regular 22ml", "brand": "Colgate", "variant": "Regular 22ml", "price": 22.0},
    {"sku": "DATU-SOY-200", "name": "Datu Puti Soy Sauce 200ml", "brand": "Datu Puti", "variant": "Soy Sauce 200ml", "price": 16.0},
    {"sku": "MAGGI-SARAP-8", "name": "Maggi Magic Sarap 8g", "brand": "Maggi", "variant": "Magic Sarap 8g", "price": 6.0},
]


class MockVisionProvider:
    """Deterministic stand-in for a real detector/VLM. Seeded by the image bytes."""
    name = "mock"

    def extract(self, image: bytes, kind: str, catalog: list[dict]) -> ExtractionResult:
        rng = random.Random(hashlib.sha256(image).hexdigest())
        pool = [c for c in catalog if c.get("sku")] or []
        # mix the store's own products with reference SKUs so new products also appear
        pool = pool + [r for r in REFERENCE_SKUS if r["sku"] not in {p["sku"] for p in pool}]
        n = rng.randint(3, 6)
        picks = rng.sample(pool, min(n, len(pool)))
        items = []
        for p in picks:
            price = float(p.get("price") or 0)
            if kind == "shelf":
                qty, unit_price = rng.randint(0, 12), 0.0           # facings/units counted on the shelf
            elif kind == "receipt":
                qty, unit_price = rng.choice([6, 12, 24, 36]), round(price * 0.85, 2)  # wholesale purchase
            else:
                qty, unit_price = rng.randint(1, 8), price           # handwritten sales ledger
            items.append(ExtractedItem(sku=p["sku"], name=p.get("name", p["sku"]), brand=p.get("brand") or "", variant=p.get("variant") or "",
                                       qty=qty, unit_price=unit_price, confidence=round(rng.uniform(0.62, 0.98), 2)))
        return ExtractionResult(provider=self.name, items=items, note="Deterministic mock extraction (no vision API key set).")


PROMPTS = {
    "shelf": "This is a photo of a sari-sari store shelf or fridge. List each distinct product you can read and count the units/facings visible.",
    "receipt": "This is a wholesale purchase receipt. List every purchased line with quantity and unit price.",
    "ledger": "This is a handwritten sales ledger (listahan) from a sari-sari store. List each product sold with quantity and unit price.",
}
SCHEMA_HINT = ('Reply with JSON only: {"items":[{"sku":"catalog SKU if it matches, else a short UPPER-KEBAB code","name":"Brand Product Variant",'
               '"brand":"Brand","variant":"Variant/size","qty":1,"unit_price":0.0,"confidence":0.0}]}. Use confidence 0..1. Skip unreadable items.')


def _prompt(kind: str, catalog: list[dict]) -> str:
    cat = "\n".join(f"{c['sku']}: {c.get('name', '')}" for c in catalog[:200])
    return f"{PROMPTS[kind]}\nKnown store catalog (match to these SKUs when possible):\n{cat}\n{SCHEMA_HINT}"


def _parse_items(text: str) -> list[ExtractedItem]:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    out = []
    for x in (data.get("items") or [])[:60]:
        if not isinstance(x, dict) or not (x.get("sku") or x.get("name")):
            continue
        name = str(x.get("name") or x.get("sku"))[:160]
        sku = re.sub(r"[^A-Z0-9-]+", "-", str(x.get("sku") or name).upper()).strip("-")[:64] or "UNKNOWN"
        try:
            out.append(ExtractedItem(sku=sku, name=name, brand=str(x.get("brand") or "")[:80], variant=str(x.get("variant") or "")[:80],
                                     qty=max(0, int(float(x.get("qty") or 0))), unit_price=max(0.0, float(x.get("unit_price") or 0)),
                                     confidence=min(1.0, max(0.0, float(x.get("confidence") or 0.5)))))
        except (TypeError, ValueError):
            continue
    return out


def _mime(image: bytes) -> str:
    return "image/png" if image[:8] == b"\x89PNG\r\n\x1a\n" else "image/webp" if image[8:12] == b"WEBP" else "image/jpeg"


class OpenAICompatibleProvider:
    def __init__(self, api_key: str, model: str, base_url: str, timeout: float = 90):
        self.name = f"openai_compatible:{model}"
        self.api_key, self.model, self.base_url, self.timeout = api_key, model, base_url.rstrip("/"), timeout

    def extract(self, image: bytes, kind: str, catalog: list[dict]) -> ExtractionResult:
        b64 = base64.b64encode(image).decode()
        body = {"model": self.model, "temperature": 0, "messages": [{"role": "user", "content": [
            {"type": "text", "text": _prompt(kind, catalog)},
            {"type": "image_url", "image_url": {"url": f"data:{_mime(image)};base64,{b64}"}}]}]}
        r = httpx.post(f"{self.base_url}/chat/completions", json=body, headers={"Authorization": f"Bearer {self.api_key}"}, timeout=self.timeout)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"] or ""
        return ExtractionResult(provider=self.name, items=_parse_items(text))


class AnthropicProvider:
    def __init__(self, api_key: str, model: str, base_url: str = "https://api.anthropic.com", timeout: float = 90):
        self.name = f"anthropic:{model}"
        self.api_key, self.model, self.base_url, self.timeout = api_key, model, base_url.rstrip("/"), timeout

    def extract(self, image: bytes, kind: str, catalog: list[dict]) -> ExtractionResult:
        body = {"model": self.model, "max_tokens": 2000, "messages": [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": _mime(image), "data": base64.b64encode(image).decode()}},
            {"type": "text", "text": _prompt(kind, catalog)}]}]}
        r = httpx.post(f"{self.base_url}/v1/messages", json=body, timeout=self.timeout,
                       headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01"})
        r.raise_for_status()
        text = "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text")
        return ExtractionResult(provider=self.name, items=_parse_items(text))


def get_provider() -> VisionProvider:
    choice = (os.environ.get("VISION_PROVIDER") or "mock").lower()
    key = os.environ.get("VISION_API_KEY")
    if choice == "openai_compatible" and key:
        return OpenAICompatibleProvider(key, os.environ.get("VISION_MODEL", "gpt-4o-mini"), os.environ.get("VISION_API_BASE", "https://api.openai.com/v1"))
    if choice == "anthropic" and key:
        return AnthropicProvider(key, os.environ.get("VISION_MODEL", "claude-sonnet-5-5"), os.environ.get("VISION_API_BASE", "https://api.anthropic.com"))
    p = MockVisionProvider()
    if choice != "mock":
        p.name = f"mock (fallback: {choice} not configured)"
    return p
