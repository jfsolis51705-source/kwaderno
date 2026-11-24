"""Google Gemini vision provider (REST). Requires GEMINI_API_KEY. Images and PDFs are sent inline."""
from __future__ import annotations

import base64
import json
import os

import httpx

from ..normalize import normalize
from ..schema import Extraction
from .base import PROMPT, ProviderError

_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "supplier_name": {"type": "STRING", "nullable": True},
        "receipt_number": {"type": "STRING", "nullable": True},
        "purchase_date": {"type": "STRING", "nullable": True},
        "discount": {"type": "NUMBER", "nullable": True},
        "tax": {"type": "NUMBER", "nullable": True},
        "grand_total": {"type": "NUMBER", "nullable": True},
        "overall_confidence": {"type": "NUMBER", "nullable": True},
        "lines": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "description": {"type": "STRING"},
                    "quantity": {"type": "NUMBER", "nullable": True},
                    "unit_price": {"type": "NUMBER", "nullable": True},
                    "line_total": {"type": "NUMBER", "nullable": True},
                    "confidence": {"type": "NUMBER", "nullable": True},
                },
                "required": ["description"],
            },
        },
    },
    "required": ["lines"],
}


class GeminiProvider:
    name = "gemini"

    def __init__(self) -> None:
        self.key = os.environ.get("GEMINI_API_KEY", "")
        self.model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        self.base = os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com")

    async def extract(self, data: bytes, mime: str) -> Extraction:
        if not self.key:
            raise ProviderError("GEMINI_API_KEY is not set")
        body = {
            "contents": [{"role": "user", "parts": [{"text": PROMPT}, {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}]}],
            "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": _SCHEMA},
        }
        url = f"{self.base}/v1beta/models/{self.model}:generateContent"
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(url, json=body, headers={"x-goog-api-key": self.key})
        if r.status_code != 200:
            raise ProviderError(f"Gemini returned {r.status_code}")
        payload = r.json()
        try:
            text = payload["candidates"][0]["content"]["parts"][0]["text"]
            draft = json.loads(text)
        except (KeyError, IndexError, json.JSONDecodeError) as e:
            raise ProviderError("Gemini response was not valid JSON") from e
        return normalize(draft, f"{self.name}:{self.model}", raw={"model": self.model, "response": draft})
