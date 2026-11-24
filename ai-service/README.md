# KWADERNO Receipt AI service

Stateless FastAPI service that turns a receipt photo/PDF into structured lines. The app keeps the
original file, the raw output, and requires merchant review before any stock changes.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
RECEIPT_PROVIDER=mock AI_SERVICE_TOKEN=dev .venv/bin/uvicorn app.main:app --port 8001
.venv/bin/python -m pytest
```

| Provider | Use | Needs |
|---|---|---|
| `mock` | Local dev/demo. Returns a fixed sample, labelled "mock" | nothing |
| `gemini` | Recommended for the pilot (no GPU) | `GEMINI_API_KEY` (optional `GEMINI_MODEL`) |
| `paddle_qwen` | Fully open-weight: PaddleOCR + Qwen3-VL via an OpenAI-compatible server | `QWEN_VL_BASE_URL`, GPU host; `pip install -r requirements-paddle.txt` for OCR/PDF |

API: `POST /v1/extract` (multipart `file`, `Authorization: Bearer $AI_SERVICE_TOKEN`) → JSON in centavos
(see `app/schema.py`, mirrored by `src/server/ai/extractor.ts`). `GET /health`.
Files are type-checked by content, size-limited, and never stored.
