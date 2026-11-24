from conftest import photo, recompress, upload
from main import create_app
from vision_service import MockVisionProvider, _parse_items, get_provider


def products(client, store_id):
    return {p["sku"]: p for p in client.get(f"/api/stores/{store_id}/products").json()}


def test_health_reports_mock_provider(anon):
    client = anon
    r = client.get("/api/health").json()
    assert r["ok"] and r["vision_provider"] == "mock" and "Super8" in r["distributors"]


# ---------- capture ingestion ----------
def test_capture_ingestion_extracts_reviewable_items(client, store):
    r = upload(client, store["id"], photo(1))
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["status"] == "pending_review" and c["quality_ok"] and not c["duplicate_of"]
    assert 3 <= len(c["items"]) <= 6
    for it in c["items"]:
        assert set(["sku", "brand", "variant", "qty", "unit_price", "confidence"]) <= set(it)
        assert 0 <= it["confidence"] <= 1
    assert c["image_url"].startswith("/api/media/captures/") and "sig=" in c["image_url"]
    assert client.get(c["image_url"]).status_code == 200
    # the mock provider is deterministic for the same image
    assert MockVisionProvider().extract(photo(1), "shelf", []).items == MockVisionProvider().extract(photo(1), "shelf", []).items


def test_rejects_non_images_and_bad_kind(client, store):
    assert client.post("/api/captures", data={"store_id": str(store["id"]), "kind": "shelf"}, files={"file": ("x.jpg", b"not an image" * 100, "image/jpeg")}).status_code == 422
    assert upload(client, store["id"], photo(2), kind="selfie").status_code == 422
    assert upload(client, 9999, photo(2)).status_code == 404


# ---------- duplicate & quality checks ----------
def test_exact_and_near_duplicates_are_rejected(client, store):
    first = upload(client, store["id"], photo(10)).json()
    again = upload(client, store["id"], photo(10)).json()
    assert again["status"] == "rejected" and again["duplicate_of"] == first["id"] and again["items"] == []
    resaved = upload(client, store["id"], recompress(photo(10))).json()
    assert resaved["status"] == "rejected" and resaved["duplicate_of"] == first["id"]
    other = upload(client, store["id"], photo(11)).json()
    assert other["status"] == "pending_review" and other["duplicate_of"] is None
    # a duplicate can never be confirmed (so it can never earn points or move stock)
    assert client.post(f"/api/captures/{again['id']}/confirm", json={"items": []}).status_code == 409
    log = client.get(f"/api/portal/audit?store_id={store['id']}").json()
    assert any(a["action"] == "capture_rejected" and a["detail"].get("reason") == "duplicate_photo" for a in log)


def test_offline_retry_with_same_client_id_is_idempotent(client, store):
    a = upload(client, store["id"], photo(20), client_id="offline-abc-123").json()
    b = upload(client, store["id"], photo(20), client_id="offline-abc-123").json()
    assert a["id"] == b["id"] and b["status"] == "pending_review"


def test_low_quality_photo_is_flagged_and_earns_no_points(client, store, ops):
    c = upload(client, store["id"], photo(30, size=(300, 240), blur=6)).json()
    assert not c["quality_ok"] and {"low_resolution", "blurry"} <= set(c["quality_issues"])
    done = client.post(f"/api/captures/{c['id']}/confirm", json={"items": c["items"]}).json()
    assert done["status"] == "verified" and done["points_awarded"] == 0
    assert client.get(f"/api/stores/{store['id']}/rewards").json()["balance"] == 0
    # only KELSON operations can override after checking the photo
    c2 = upload(client, store["id"], photo(31, size=(300, 240), blur=6)).json()
    assert client.post(f"/api/captures/{c2['id']}/confirm", json={"items": [], "award_low_quality": True}).status_code == 403
    done2 = ops.post(f"/api/captures/{c2['id']}/confirm", json={"items": [], "award_low_quality": True}).json()
    assert done2["points_awarded"] == 10


# ---------- inventory updates ----------
def test_confirmed_captures_update_inventory(client, store):
    sid = store["id"]
    shelf = upload(client, sid, photo(40)).json()
    items = [{"sku": "LM-PC-ORIG-60", "brand": "Lucky Me", "variant": "Original 60g", "qty": 3, "unit_price": 0, "confidence": 0.9},
             {"sku": "NEW-SKU-1", "name": "Rebisco Crackers 10s", "brand": "Rebisco", "variant": "10s", "qty": 7, "unit_price": 0, "confidence": 0.8}]
    client.post(f"/api/captures/{shelf['id']}/confirm", json={"items": items}).raise_for_status()
    p = products(client, sid)
    assert p["LM-PC-ORIG-60"]["qty_on_hand"] == 3 and p["LM-PC-ORIG-60"]["status"] == "low"  # shelf count sets the stock
    assert p["NEW-SKU-1"]["qty_on_hand"] == 7 and p["NEW-SKU-1"]["name"] == "Rebisco Crackers 10s"  # unknown SKU is added
    receipt = upload(client, sid, photo(41), kind="receipt").json()
    client.post(f"/api/captures/{receipt['id']}/confirm", json={"items": [{"sku": "555-SARD-155", "qty": 24, "unit_price": 20.5}]}).raise_for_status()
    p = products(client, sid)
    assert p["555-SARD-155"]["qty_on_hand"] == 24 and p["555-SARD-155"]["cost"] == 20.5 and p["555-SARD-155"]["status"] == "ok"
    ledger = upload(client, sid, photo(42), kind="ledger").json()
    client.post(f"/api/captures/{ledger['id']}/confirm", json={"items": [{"sku": "555-SARD-155", "qty": 5, "unit_price": 24}, {"sku": "COKE-MISMO", "qty": 9, "unit_price": 20}]}).raise_for_status()
    p = products(client, sid)
    assert p["555-SARD-155"]["qty_on_hand"] == 19
    assert p["COKE-MISMO"]["qty_on_hand"] == 0 and p["COKE-MISMO"]["status"] == "out"  # never below zero
    assert client.post(f"/api/captures/{ledger['id']}/confirm", json={"items": []}).status_code == 409  # only once


def test_barcode_lookup_and_quick_adjust(client, store):
    sid = store["id"]
    assert client.get(f"/api/stores/{sid}/lookup", params={"code": "4800016644290"}).json()["sku"] == "LM-PC-ORIG-60"
    r = client.post("/api/inventory/adjust", json={"store_id": sid, "barcode": "4800016644290", "delta": 1, "reason": "barcode"}).json()
    assert r["qty_on_hand"] == 11
    r = client.post("/api/inventory/adjust", json={"store_id": sid, "sku": "COKE-MISMO", "delta": -5, "reason": "manual"}).json()
    assert r["qty_on_hand"] == 0 and r["status"] == "out"
    assert client.post("/api/inventory/adjust", json={"store_id": sid, "barcode": "000", "delta": 1}).status_code == 404
    assert client.get(f"/api/stores/{sid}/lookup", params={"code": "nope"}).status_code == 404


def test_product_edit_and_thumbnail(client, store):
    p = products(client, store["id"])["COKE-MISMO"]
    r = client.patch(f"/api/products/{p['id']}", json={"name": "Coke Mismo 290ml", "price": 21, "reorder_level": 12}).json()
    assert r["name"] == "Coke Mismo 290ml" and r["price"] == 21 and r["reorder_level"] == 12
    t = client.post(f"/api/products/{p['id']}/thumbnail", files={"file": ("t.png", photo(50, fmt="PNG"), "image/png")}).json()
    assert t["thumbnail_url"].startswith("/api/media/thumbs/") and client.get(t["thumbnail_url"]).status_code == 200
    assert client.post(f"/api/stores/{store['id']}/products", json={"sku": "COKE-MISMO", "name": "dup"}).status_code == 409


# ---------- wholesale orders ----------
def test_wholesale_order_lifecycle(client, store):
    sid = store["id"]
    o = client.post("/api/orders/draft", json={"store_id": sid, "distributor": "Suy Sing"}).json()
    assert o["status"] == "draft" and o["distributor"] == "Suy Sing"
    skus = {l["sku"]: l for l in o["lines"]}
    assert set(skus) == {"COKE-MISMO", "555-SARD-155"}  # only low / out-of-stock items
    assert skus["COKE-MISMO"]["qty"] == 10 and skus["555-SARD-155"]["qty"] == 8  # reorder*2 - on hand
    pm = products(client, sid)
    o = client.patch(f"/api/orders/{o['id']}", json={"lines": [{"product_id": pm["COKE-MISMO"]["id"], "qty": 24}, {"product_id": pm["555-SARD-155"]["id"], "qty": 0},
                                                               {"product_id": pm["LM-PC-ORIG-60"]["id"], "qty": 12}], "distributor": "Super8"}).json()
    assert {l["sku"]: l["qty"] for l in o["lines"]} == {"COKE-MISMO": 24, "LM-PC-ORIG-60": 12} and o["distributor"] == "Super8" and o["total"] > 0
    assert client.post(f"/api/orders/{o['id']}/status", json={"status": "fulfilled"}).status_code == 409  # must be submitted first
    o = client.post(f"/api/orders/{o['id']}/status", json={"status": "submitted"}).json()
    assert o["status"] == "submitted" and o["submitted_at"]
    assert client.patch(f"/api/orders/{o['id']}", json={"note": "x"}).status_code == 409  # no edits after submit
    o = client.post(f"/api/orders/{o['id']}/status", json={"status": "fulfilled"}).json()
    assert o["status"] == "fulfilled"
    pm = products(client, sid)
    assert pm["COKE-MISMO"]["qty_on_hand"] == 26 and pm["LM-PC-ORIG-60"]["qty_on_hand"] == 22  # stock received
    empty = client.post("/api/orders/draft", json={"store_id": sid}).json()
    client.patch(f"/api/orders/{empty['id']}", json={"lines": [{"product_id": l["product_id"], "qty": 0} for l in empty["lines"]]}).raise_for_status()
    assert client.post(f"/api/orders/{empty['id']}/status", json={"status": "submitted"}).status_code == 422


# ---------- rewards ----------
def test_rewards_credited_once_per_verified_capture(client, store):
    sid = store["id"]
    s1 = upload(client, sid, photo(60)).json()
    r1 = upload(client, sid, photo(61), kind="receipt").json()
    client.post(f"/api/captures/{s1['id']}/confirm", json={"items": s1["items"]}).raise_for_status()
    client.post(f"/api/captures/{r1['id']}/confirm", json={"items": r1["items"]}).raise_for_status()
    dup = upload(client, sid, photo(60)).json()
    assert dup["status"] == "rejected"
    rej = upload(client, sid, photo(62)).json()
    client.post(f"/api/captures/{rej['id']}/reject", data={"reason": "Not a shelf"}).raise_for_status()
    rw = client.get(f"/api/stores/{sid}/rewards").json()
    assert rw["balance"] == 25 and len(rw["history"]) == 2
    assert rw["redemptions"][0]["points_short"] == 175 and not rw["redemptions"][0]["can_redeem"]


# ---------- offline sync ----------
def test_sync_queue_is_idempotent(client, store):
    sid = store["id"]
    ops = [{"op_id": "op-0001-aaaa", "type": "adjust", "payload": {"sku": "COKE-MISMO", "delta": 5, "reason": "barcode"}},
           {"op_id": "op-0002-bbbb", "type": "product_upsert", "payload": {"sku": "EGG-PC", "name": "Egg (per piece)", "price": 9.5, "qty_on_hand": 30, "reorder_level": 12}},
           {"op_id": "op-0003-cccc", "type": "adjust", "payload": {"sku": "MISSING", "delta": 1}},
           {"op_id": "op-0004-dddd", "type": "product_patch", "payload": {"sku": "EGG-PC", "price": 10}}]
    res = client.post("/api/sync", json={"store_id": sid, "ops": ops}).json()["results"]
    assert [r["ok"] for r in res] == [True, True, False, True]
    again = client.post("/api/sync", json={"store_id": sid, "ops": ops}).json()["results"]
    assert again[0]["duplicate"] and again[1]["duplicate"]
    p = products(client, sid)
    assert p["COKE-MISMO"]["qty_on_hand"] == 7  # applied once, not twice
    assert p["EGG-PC"]["qty_on_hand"] == 30 and p["EGG-PC"]["price"] == 10


# ---------- portal ----------
def test_portal_overview_and_alerts(client, store, ops):
    sid = store["id"]
    c = upload(client, sid, photo(70)).json()
    client.post(f"/api/captures/{c['id']}/confirm", json={"items": [{"sku": "COKE-MISMO", "brand": "Coca-Cola", "qty": 6}, {"sku": "LM-PC-ORIG-60", "brand": "Lucky Me", "qty": 2}]}).raise_for_status()
    client.post("/api/orders/draft", json={"store_id": sid})
    assert client.get("/api/portal/overview").status_code == 403  # merchants can't open the portal
    ov = ops.get("/api/portal/overview").json()
    row = ov["stores"][0]
    assert row["skus"] == 3 and row["out"] == 1 and row["low"] == 2 and row["points"] == 10  # 6 on hand with reorder level 6 is "low"
    assert {a["sku"] for a in ov["alerts"]} == {"555-SARD-155", "LM-PC-ORIG-60", "COKE-MISMO"}
    assert ov["alerts"][0]["status"] == "out"
    assert ov["share_of_shelf"][0] == {"brand": "Coca-Cola", "units": 6, "share": 0.75}
    assert ov["totals"]["open_orders"] == 1 and ov["order_queue"][0]["store"] == "Test Store"


def test_demo_seed_starts_with_data(tmp_path):
    from fastapi.testclient import TestClient
    app = create_app(database_url=f"sqlite:///{tmp_path / 'seed.db'}", upload_dir=str(tmp_path / "up"), vision=MockVisionProvider(), seed=True)
    with TestClient(app) as c:
        tok = c.post("/api/auth/login", json={"email": "ops@demo.kwaderno.ph", "password": "demo1234"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {tok}"
        ov = c.get("/api/portal/overview").json()
        nena = c.post("/api/auth/login", json={"email": "nena@demo.kwaderno.ph", "password": "demo1234"}).json()
        assert [st["name"] for st in nena["stores"]] == ["Aling Nena Sari-sari"]
        assert ov["totals"]["stores"] == 4 and ov["totals"]["skus"] >= 56  # shelf photos can add new products
        assert ov["captures_by_status"]["verified"] == 4 and ov["captures_by_status"]["rejected"] == 1
        assert ov["share_of_shelf"] and ov["order_queue"]


# ---------- vision adapters ----------
def test_vlm_reply_parsing_and_provider_fallback(monkeypatch):
    items = _parse_items('Sure! {"items":[{"sku":"coke mismo","name":"Coke Mismo","brand":"Coca-Cola","qty":"4","unit_price":20,"confidence":1.4},{"bad":1}]}')
    assert len(items) == 1 and items[0].sku == "COKE-MISMO" and items[0].qty == 4 and items[0].confidence == 1.0
    assert _parse_items("no json here") == []
    monkeypatch.setenv("VISION_PROVIDER", "anthropic")
    monkeypatch.delenv("VISION_API_KEY", raising=False)
    assert get_provider().name.startswith("mock (fallback")
    monkeypatch.setenv("VISION_API_KEY", "k")
    assert get_provider().name.startswith("anthropic:")
