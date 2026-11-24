import json

import pytest
from fastapi.testclient import TestClient

from app import main
from app.normalize import normalize, to_centavos, to_date

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("RECEIPT_PROVIDER", "mock")
    monkeypatch.setenv("AI_SERVICE_TOKEN", "secret")
    return TestClient(main.app)


def test_health(client):
    assert client.get("/health").json()["ok"] is True


def test_requires_token(client):
    r = client.post("/v1/extract", files={"file": ("r.png", PNG, "image/png")})
    assert r.status_code == 401


def test_rejects_non_images(client):
    r = client.post("/v1/extract", files={"file": ("x.png", b"<html>hi</html>" * 4, "image/png")}, headers={"authorization": "Bearer secret"})
    assert r.status_code == 415


def test_mock_extraction_contract(client):
    r = client.post("/v1/extract", files={"file": ("r.png", PNG, "image/png")}, headers={"authorization": "Bearer secret"})
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "mock"
    assert body["lines"][0] == {"description": "MEGA SARDINES TOMATO 155G", "quantity": 24.0, "unitPriceCentavos": 2000, "lineTotalCentavos": 48000, "confidence": 0.93}
    assert body["grandTotalCentavos"] == 48000 + 23000 + 40200


def test_gemini_without_key_is_503(client, monkeypatch):
    monkeypatch.setenv("RECEIPT_PROVIDER", "gemini")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = client.post("/v1/extract", files={"file": ("r.png", PNG, "image/png")}, headers={"authorization": "Bearer secret"})
    assert r.status_code == 503


def test_money_and_dates():
    assert to_centavos("₱1,234.50") == 123450
    assert to_centavos(12) == 1200
    assert to_centavos("abc") is None
    assert to_date("11/20/2026") == "2026-11-20"
    assert to_date("Nov 20, 2026") == "2026-11-20"
    assert to_date("not a date") is None


def test_normalize_fills_and_flags():
    e = normalize(
        {"lines": [{"description": " Coke  1L ", "quantity": 6, "line_total": "300.00"}, {"description": "Bad math", "quantity": 2, "unit_price": 10, "line_total": 999}, {"description": ""}], "grand_total": 1299},
        "test",
    )
    assert [l.description for l in e.lines] == ["Coke 1L", "Bad math"]
    assert e.lines[0].unitPriceCentavos == 5000
    assert e.lines[1].confidence <= 0.4
    assert json.loads(e.model_dump_json())["provider"] == "test"
