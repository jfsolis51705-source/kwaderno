"""
KWADERNO receipt AI service.

  POST /v1/extract   multipart `file` (JPG/PNG/WebP/PDF) -> Extraction JSON (centavos)
  GET  /health

Auth: `Authorization: Bearer $AI_SERVICE_TOKEN` (shared secret with the app; required unless
AI_SERVICE_TOKEN is empty in development). Provider: RECEIPT_PROVIDER = gemini | paddle_qwen | mock.
The service is stateless: it never stores uploads.
"""
from __future__ import annotations

import hmac
import logging
import os

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile

from .providers.base import ProviderError
from .schema import Extraction

log = logging.getLogger("kwaderno.ai")
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "10")) * 1024 * 1024
SIGS = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png", b"%PDF-": "application/pdf"}

app = FastAPI(title="KWADERNO Receipt AI", version="1.0.0")


def get_provider():
    name = os.environ.get("RECEIPT_PROVIDER", "mock").lower()
    if name == "gemini":
        from .providers.gemini import GeminiProvider

        return GeminiProvider()
    if name == "paddle_qwen":
        from .providers.paddle_qwen import PaddleQwenProvider

        return PaddleQwenProvider()
    if name == "mock":
        from .providers.mock import MockProvider

        return MockProvider()
    raise RuntimeError(f"Unknown RECEIPT_PROVIDER {name!r}")


def require_token(authorization: str = Header(default="")) -> None:
    expected = os.environ.get("AI_SERVICE_TOKEN", "")
    if not expected:
        return  # development only — set a token in any shared environment
    given = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(given, expected):
        raise HTTPException(status_code=401, detail="invalid token")


def sniff(data: bytes) -> str:
    for sig, mime in SIGS.items():
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(status_code=415, detail="unsupported file type")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "provider": os.environ.get("RECEIPT_PROVIDER", "mock")}


@app.post("/v1/extract", response_model=Extraction, dependencies=[Depends(require_token)])
async def extract(file: UploadFile = File(...), provider=Depends(get_provider)) -> Extraction:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file too large")
    if not data:
        raise HTTPException(status_code=422, detail="empty file")
    mime = sniff(data)
    try:
        return await provider.extract(data, mime)
    except ProviderError as e:
        log.warning("provider error: %s", e)
        raise HTTPException(status_code=503, detail=str(e)) from e
