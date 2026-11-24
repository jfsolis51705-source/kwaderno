"""Accounts, sessions, roles, store isolation and signed media links."""
import time

from conftest import photo, register, upload


def test_register_login_me_logout(anon):
    r = register(anon, "nena@store.ph", "Nena Store")
    assert r["user"]["role"] == "merchant" and r["stores"][0]["role"] == "owner" and r["stores"][0]["name"] == "Nena Store"
    assert anon.post("/api/auth/register", json={"email": "NENA@store.ph", "password": "another-pass", "name": "x", "store_name": "y"}).status_code == 409
    assert anon.post("/api/auth/login", json={"email": "nena@store.ph", "password": "wrong-pass"}).status_code == 401
    tok = anon.post("/api/auth/login", json={"email": "Nena@Store.ph", "password": "secret-pass-1"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert anon.get("/api/auth/me", headers=h).json()["user"]["email"] == "nena@store.ph"
    assert anon.post("/api/auth/logout", headers=h).status_code == 204
    assert anon.get("/api/auth/me", headers=h).status_code == 401


def test_password_rules_and_hashing(anon, app):
    assert anon.post("/api/auth/register", json={"email": "a@b.ph", "password": "short", "name": "a", "store_name": "s"}).status_code == 422
    assert anon.post("/api/auth/register", json={"email": "not-an-email", "password": "long-enough", "name": "a", "store_name": "s"}).status_code == 422
    register(anon, "hash@test.ph")
    from db import User
    with app.state.db.Session() as s:
        u = s.query(User).filter_by(email="hash@test.ph").one()
        assert u.password_hash.startswith("scrypt$") and "secret-pass-1" not in u.password_hash


def test_everything_requires_login(anon):
    for method, path in [("get", "/api/stores"), ("get", "/api/stores/1/products"), ("get", "/api/captures"), ("get", "/api/orders"),
                         ("get", "/api/portal/overview"), ("get", "/api/stores/1/rewards"), ("post", "/api/inventory/adjust")]:
        r = getattr(anon, method)(path) if method == "get" else anon.post(path, json={"store_id": 1, "sku": "X", "delta": 1})
        assert r.status_code == 401, path
    assert anon.get("/api/stores", headers={"Authorization": "Bearer made-up-token"}).status_code == 401


def test_login_rate_limit(anon):
    register(anon, "rl@test.ph")
    codes = [anon.post("/api/auth/login", json={"email": "rl@test.ph", "password": "bad-guess"}).status_code for _ in range(10)]
    assert codes[:8] == [401] * 8 and codes[-1] == 429


def test_store_isolation(client, store, anon, ops):
    other = register(anon, "rival@test.ph", "Rival Store")
    h = {"Authorization": f"Bearer {other['token']}"}
    sid = store["id"]
    pid = client.get(f"/api/stores/{sid}/products").json()[0]["id"]
    cap = upload(client, sid, photo(300)).json()
    order = client.post("/api/orders/draft", json={"store_id": sid}).json()
    # the rival merchant can't see or touch anything of Test Store
    assert [x["name"] for x in anon.get("/api/stores", headers=h).json()] == ["Rival Store"]
    for r in [anon.get(f"/api/stores/{sid}/products", headers=h), anon.get(f"/api/stores/{sid}/lookup?code=COKE-MISMO", headers=h),
              anon.get(f"/api/stores/{sid}/rewards", headers=h), anon.get(f"/api/captures/{cap['id']}", headers=h),
              anon.post(f"/api/captures/{cap['id']}/confirm", json={"items": []}, headers=h), anon.patch(f"/api/products/{pid}", json={"price": 1}, headers=h),
              anon.post("/api/inventory/adjust", json={"store_id": sid, "sku": "COKE-MISMO", "delta": -2}, headers=h),
              anon.post("/api/sync", json={"store_id": sid, "ops": [{"op_id": "evil-op-0001", "type": "adjust", "payload": {"sku": "COKE-MISMO", "delta": -2}}]}, headers=h),
              anon.patch(f"/api/orders/{order['id']}", json={"note": "x"}, headers=h), anon.post(f"/api/orders/{order['id']}/status", json={"status": "cancelled"}, headers=h),
              anon.get(f"/api/portal/audit?store_id={sid}", headers=h)]:
        assert r.status_code == 404, r.request.url
    assert anon.get("/api/captures", headers=h).json() == [] and anon.get("/api/orders", headers=h).json() == []
    assert anon.get("/api/portal/overview", headers=h).status_code == 403
    # nothing changed
    assert {p["sku"]: p["qty_on_hand"] for p in client.get(f"/api/stores/{sid}/products").json()}["COKE-MISMO"] == 2
    # operations can see every store
    assert {x["name"] for x in ops.get("/api/stores").json()} == {"Test Store", "Rival Store"}


def test_staff_role(client, store, anon):
    r = client.post(f"/api/stores/{store['id']}/members", json={"email": "staff@test.ph", "name": "Staff", "password": "staff-pass-1"})
    assert r.status_code == 201 and r.json()["role"] == "staff"
    assert client.post(f"/api/stores/{store['id']}/members", json={"email": "staff@test.ph", "name": "Staff"}).status_code == 409
    tok = anon.post("/api/auth/login", json={"email": "staff@test.ph", "password": "staff-pass-1"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    pid = client.get(f"/api/stores/{store['id']}/products").json()[0]["id"]
    # staff can sell/count stock and capture, but not change prices or add members
    assert anon.post("/api/inventory/adjust", json={"store_id": store["id"], "sku": "COKE-MISMO", "delta": 1, "reason": "barcode"}, headers=h).status_code == 200
    assert anon.patch(f"/api/products/{pid}", json={"price": 1}, headers=h).status_code == 403
    assert anon.post(f"/api/stores/{store['id']}/members", json={"email": "x@test.ph", "name": "x", "password": "xxxxxxxx1"}, headers=h).status_code == 403
    res = anon.post("/api/sync", json={"store_id": store["id"], "ops": [{"op_id": "staff-op-0001", "type": "product_patch", "payload": {"sku": "COKE-MISMO", "price": 1}}]}, headers=h).json()
    assert res["results"][0]["ok"] is False


def test_media_links_are_signed_and_expire(client, store, anon, monkeypatch):
    c = upload(client, store["id"], photo(400)).json()
    url = c["image_url"]
    assert anon.get(url).status_code == 200  # a signed link works without a login (for <img> tags)
    path = url.split("?")[0]
    assert anon.get(path).status_code == 422  # unsigned
    assert anon.get(url.replace("sig=", "sig=0")).status_code == 403  # tampered
    import auth
    expired = auth.sign_media(url.split("/api/media/")[1].split("?")[0], ttl=1)
    monkeypatch.setattr(time, "time", lambda: 10**12)
    assert anon.get(expired).status_code == 403
    assert anon.get("/media/" + url.split("/api/media/")[1].split("?")[0]).status_code == 404  # no public static folder


def test_client_id_reuse_across_stores_is_blocked(client, store, anon):
    upload(client, store["id"], photo(500), client_id="shared-client-id-1")
    other = register(anon, "rival2@test.ph", "Rival 2")
    anon.headers["Authorization"] = f"Bearer {other['token']}"
    r = upload(anon, other["stores"][0]["id"], photo(500), client_id="shared-client-id-1")
    assert r.status_code == 409
