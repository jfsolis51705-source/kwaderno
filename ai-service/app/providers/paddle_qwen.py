"""
Open-weight pipeline: PaddleOCR (optional, local) for text + Qwen3-VL served behind an
OpenAI-compatible endpoint (vLLM, SGLang, Ollama…) for structuring.

  QWEN_VL_BASE_URL=http://gpu-host:8000/v1   QWEN_VL_MODEL=Qwen/Qwen3-VL-8B-Instruct   QWEN_VL_API_KEY=(optional)

PaddleOCR is used when installed (requirements-paddle.txt); its text is given to the VLM
as a hint, which improves numbers on blurry photos. PDFs are rasterised with pypdfium2.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re

import httpx

from ..normalize import normalize
from ..schema import Extraction
from .base import PROMPT, ProviderError


def _pdf_first_page_png(data: bytes) -> bytes:
    try:
        import pypdfium2 as pdfium  # type: ignore
    except ImportError as e:
        raise ProviderError("PDF receipts need pypdfium2 for the paddle_qwen provider") from e
    page = pdfium.PdfDocument(data)[0]
    img = page.render(scale=2).to_pil()
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def _ocr_text(png_or_jpg: bytes) -> str | None:
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError:
        return None
    import numpy as np  # type: ignore
    from PIL import Image  # type: ignore

    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    img = np.array(Image.open(io.BytesIO(png_or_jpg)).convert("RGB"))
    result = ocr.ocr(img, cls=True) or []
    lines = [w[1][0] for block in result for w in (block or [])]
    return "\n".join(lines) or None


class PaddleQwenProvider:
    name = "paddle_qwen"

    def __init__(self) -> None:
        self.base = os.environ.get("QWEN_VL_BASE_URL", "")
        self.model = os.environ.get("QWEN_VL_MODEL", "Qwen/Qwen3-VL-8B-Instruct")
        self.key = os.environ.get("QWEN_VL_API_KEY", "")

    async def extract(self, data: bytes, mime: str) -> Extraction:
        if not self.base:
            raise ProviderError("QWEN_VL_BASE_URL is not set")
        if mime == "application/pdf":
            data, mime = _pdf_first_page_png(data), "image/png"
        ocr = _ocr_text(data)
        text = PROMPT + (f"\n\nOCR text (may contain errors):\n{ocr}" if ocr else "")
        body = {
            "model": self.model,
            "temperature": 0,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{base64.b64encode(data).decode()}"}},
                        {"type": "text", "text": text},
                    ],
                }
            ],
            "response_format": {"type": "json_object"},
        }
        headers = {"authorization": f"Bearer {self.key}"} if self.key else {}
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{self.base.rstrip('/')}/chat/completions", json=body, headers=headers)
        if r.status_code != 200:
            raise ProviderError(f"Qwen-VL endpoint returned {r.status_code}")
        content = r.json()["choices"][0]["message"]["content"]
        m = re.search(r"\{.*\}", content, re.S)
        try:
            draft = json.loads(m.group(0) if m else content)
        except json.JSONDecodeError as e:
            raise ProviderError("Qwen-VL response was not valid JSON") from e
        return normalize(draft, f"{self.name}:{self.model}", raw={"model": self.model, "ocr": ocr, "response": draft})
