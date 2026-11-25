"""Online ordering: a public store page with pickup/delivery, prices from the server, stock deducted on completion."""
from fastapi.testclient import TestClient

from conftest import register


def products(client, sid):
    return {p["sku"]: p for p in client.get(f"/api/stores/{sid}/products").json()}


def open_shop(client, sid, **kw):
    body = {"slug": "aling-nena", "enabled": True, "pickup": True, "delivery": True, "delivery_fee": 30, "min_order": 0, **kw}
    r = client.put(f"/api/stores/{sid}/shop", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def order_body(items, **kw):
    return {"name": "Juan", "phone": "09171234567", "fulfillment": "pickup", "items": items, **kw}


def test_default_settings_suggest_a_slug_and_start_closed(client, store):
    r = client.get(f"/api/stores/{store['id']}/shop").json()
    assert r["enabled"] is False and r["slug"] == "test-store"


def test_catalog_hides_out_of_stock_and_costs(client, anon, store):
    open_shop(client, store["id"])
    r = anon.get("/api/shop/aling-nena")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()["products"]]
    assert "555 Sardines in Tomato Sauce 155g" not in names and len(names) == 2
    for p in r.json()["products"]:
        assert "cost" not in p and "sku" not in p and "qty_on_hand" not in p
    assert r.json()["shop"]["delivery_fee"] == 30


def test_disabled_or_unknown_shop_is_404(client, anon, store):
    assert anon.get("/api/shop/nope").status_code == 404
    open_shop(client, store["id"], enabled=False)
    assert anon.get("/api/shop/aling-nena").status_code == 404


def test_order_uses_server_prices_and_full_flow_deducts_stock(client, anon, store):
    sid = store["id"]
    open_shop(client, sid)
    ps = products(client, sid)
    lm, coke = ps["LM-PC-ORIG-60"], ps["COKE-MISMO"]
    r = anon.post("/api/shop/aling-nena/orders", json=order_body(
        [{"product_id": lm["id"], "qty": 3}, {"product_id": coke["id"], "qty": 1}, {"product_id": lm["id"], "qty": 1}],
        fulfillment="delivery", address="12 Mabini St, Culiat", price=1))
    assert r.status_code == 201, r.text
    o = r.json()
    assert o["subtotal"] == 4 * 18 + 20 and o["delivery_fee"] == 30 and o["total"] == 122
    assert "phone" not in o and o["token"] and len(o["code"]) == 5
    # status page needs the private token
    assert anon.get(f"/api/shop/aling-nena/orders/{o['code']}", params={"t": "wrong-token-123"}).status_code == 404
    st = anon.get(f"/api/shop/aling-nena/orders/{o['code']}", params={"t": o["token"]})
    assert st.status_code == 200 and st.json()["status"] == "new" and "phone" not in st.json()
    # store sees it, with contact details
    lst = client.get(f"/api/stores/{sid}/customer-orders", params={"status": "open"}).json()
    assert len(lst) == 1 and lst[0]["phone"] == "09171234567"
    oid = lst[0]["id"]
    # no skipping steps; stock untouched until completed
    assert client.post(f"/api/customer-orders/{oid}/status", json={"status": "completed"}).status_code == 409
    for step in ("accepted", "ready"):
        assert client.post(f"/api/customer-orders/{oid}/status", json={"status": step}).status_code == 200
    assert products(client, sid)["LM-PC-ORIG-60"]["qty_on_hand"] == 10
    r = client.post(f"/api/customer-orders/{oid}/status", json={"status": "completed"})
    assert r.status_code == 200 and r.json()["status"] == "completed"
    ps = products(client, sid)
    assert ps["LM-PC-ORIG-60"]["qty_on_hand"] == 6 and ps["COKE-MISMO"]["qty_on_hand"] == 1
    assert anon.get(f"/api/shop/aling-nena/orders/{o['code']}", params={"t": o["token"]}).json()["status"] == "completed"
    assert client.post(f"/api/customer-orders/{oid}/status", json={"status": "cancelled"}).status_code == 409


def test_order_validation(client, anon, store):
    sid = store["id"]
    open_shop(client, sid, delivery=False, min_order=50)
    ps = products(client, sid)
    lm, coke, sard = ps["LM-PC-ORIG-60"], ps["COKE-MISMO"], ps["555-SARD-155"]
    post = lambda **kw: anon.post("/api/shop/aling-nena/orders", json=order_body(**kw))
    assert post(items=[{"product_id": coke["id"], "qty": 3}]).status_code == 409  # only 2 left
    assert post(items=[{"product_id": sard["id"], "qty": 1}]).status_code == 409  # out of stock
    assert post(items=[{"product_id": lm["id"], "qty": 1}]).status_code == 400  # below minimum
    assert post(items=[{"product_id": lm["id"], "qty": 3}], fulfillment="delivery", address="x st 12").status_code == 400  # no delivery
    assert post(items=[{"product_id": lm["id"], "qty": 3}], phone="12345").status_code == 422
    assert post(items=[]).status_code == 422
    assert post(items=[{"product_id": lm["id"], "qty": 3}], website="http://spam").status_code == 400
    assert post(items=[{"product_id": 99999, "qty": 3}]).status_code == 400
    assert post(items=[{"product_id": lm["id"], "qty": 3}]).status_code == 201
    open_shop(client, sid, delivery=True)
    assert post(items=[{"product_id": lm["id"], "qty": 3}], fulfillment="delivery").status_code == 400  # needs address


def test_completion_rechecks_stock(client, anon, store):
    sid = store["id"]
    open_shop(client, sid)
    coke = products(client, sid)["COKE-MISMO"]
    o = anon.post("/api/shop/aling-nena/orders", json=order_body([{"product_id": coke["id"], "qty": 2}])).json()
    oid = client.get(f"/api/stores/{sid}/customer-orders").json()[0]["id"]
    client.post("/api/inventory/adjust", json={"store_id": sid, "sku": "COKE-MISMO", "delta": -1, "reason": "manual"})
    for step in ("accepted", "ready"):
        client.post(f"/api/customer-orders/{oid}/status", json={"status": step})
    assert client.post(f"/api/customer-orders/{oid}/status", json={"status": "completed"}).status_code == 409
    assert client.post(f"/api/customer-orders/{oid}/status", json={"status": "cancelled"}).status_code == 200
    assert o["code"]


def test_other_stores_cannot_see_or_change_orders_and_slugs_are_unique(app, client, anon, store):
    sid = store["id"]
    open_shop(client, sid)
    lm = products(client, sid)["LM-PC-ORIG-60"]
    anon.post("/api/shop/aling-nena/orders", json=order_body([{"product_id": lm["id"], "qty": 1}]))
    oid = client.get(f"/api/stores/{sid}/customer-orders").json()[0]["id"]
    with TestClient(app) as other:
        me = register(other, "other@test.ph", "Other Store")
        other.headers["Authorization"] = f"Bearer {me['token']}"
        assert other.get(f"/api/stores/{sid}/customer-orders").status_code in (403, 404)
        assert other.post(f"/api/customer-orders/{oid}/status", json={"status": "cancelled"}).status_code in (403, 404)
        assert other.put(f"/api/stores/{sid}/shop", json={"slug": "hijack"}).status_code in (403, 404)
        r = other.put(f"/api/stores/{me['stores'][0]['id']}/shop", json={"slug": "aling-nena"})
        assert r.status_code == 409


def test_public_orders_are_rate_limited(monkeypatch, tmp_path):
    monkeypatch.setenv("ORDER_RATE_LIMIT", "3")
    from main import create_app
    from vision_service import MockVisionProvider
    app = create_app(database_url=f"sqlite:///{tmp_path / 'rl.db'}", upload_dir=str(tmp_path / "u"), vision=MockVisionProvider(), seed=False)
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {register(c, 'rl@test.ph')['token']}"
        sid = c.get("/api/stores").json()[0]["id"]
        pid = c.post(f"/api/stores/{sid}/products", json={"sku": "A", "name": "Item A", "qty_on_hand": 50, "price": 10}).json()["id"]
        c.put(f"/api/stores/{sid}/shop", json={"slug": "rl-shop"})
        codes = [c.post("/api/shop/rl-shop/orders", json=order_body([{"product_id": pid, "qty": 1}])).status_code for _ in range(4)]
        assert codes == [201, 201, 201, 429]
