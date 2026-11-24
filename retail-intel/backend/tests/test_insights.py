"""Daily check-in bonus, predictive restock and the cash-flow readiness score."""
from conftest import photo, upload


def confirm(client, cid, items):
    r = client.post(f"/api/captures/{cid}/confirm", json={"items": items})
    assert r.status_code == 200, r.text
    return r.json()


def test_daily_checkin_bonus_once_per_day(client, store):
    sid = store["id"]
    assert client.get(f"/api/stores/{sid}/checkins").json()["today"] == {"date": client.get(f"/api/stores/{sid}/checkins").json()["today"]["date"], "ledger": False, "shelf": False, "complete": False}
    shelf = confirm(client, upload(client, sid, photo(900)).json()["id"], [{"sku": "COKE-MISMO", "qty": 5}])
    assert shelf["checkin_bonus"] == 0  # only half done
    ledger = confirm(client, upload(client, sid, photo(901), kind="ledger").json()["id"], [{"sku": "COKE-MISMO", "qty": 1, "unit_price": 20}])
    assert ledger["checkin_bonus"] == 10
    again = confirm(client, upload(client, sid, photo(902), kind="ledger").json()["id"], [{"sku": "COKE-MISMO", "qty": 1, "unit_price": 20}])
    assert again["checkin_bonus"] == 0  # one bonus per day
    ci = client.get(f"/api/stores/{sid}/checkins").json()
    assert ci["today"]["complete"] and ci["streak"] == 1 and len(ci["days"]) == 30
    rw = client.get(f"/api/stores/{sid}/rewards").json()
    assert rw["balance"] == 10 + 15 + 15 + 10 and any("Daily check-in" in h["reason"] for h in rw["history"])


def test_streak_bonus_after_seven_days(client, store, app):
    import insights
    from datetime import datetime, timedelta, timezone
    from db import Capture
    sid = store["id"]
    # six earlier complete days (photos dated in the past), then today completes a 7-day streak
    with app.state.db.Session() as s:
        for d in range(1, 7):
            when = datetime.now(timezone.utc) - timedelta(days=d)
            for k in ("ledger", "shelf"):
                s.add(Capture(store_id=sid, kind=k, image_path="x", sha256=f"{d}{k}".ljust(64, "0"), phash="0" * 64, width=1, height=1, size_bytes=1,
                              blur_score=100, quality_ok=True, quality_issues=[], status="verified", provider="t", items=[], created_at=when))
        s.commit()
    confirm(client, upload(client, sid, photo(910)).json()["id"], [])
    r = confirm(client, upload(client, sid, photo(911), kind="ledger").json()["id"], [])
    assert r["checkin_bonus"] == insights.CHECKIN_BONUS + insights.STREAK_BONUS
    assert client.get(f"/api/stores/{sid}/checkins").json()["streak"] == 7


def test_restock_uses_sales_pace(client, store):
    sid = store["id"]
    # Lucky Me: 10 on hand, alert at 5 -> "ok" by the alert rule, but it sells fast
    for i in range(3):
        confirm(client, upload(client, sid, photo(920 + i), kind="ledger").json()["id"], [{"sku": "LM-PC-ORIG-60", "qty": 3, "unit_price": 18}])
    fc = {r["sku"]: r for r in client.get(f"/api/stores/{sid}/forecast").json()["products"]}
    lm = fc["LM-PC-ORIG-60"]
    assert lm["qty_on_hand"] == 1 and abs(lm["per_day"] - 9 / 14) < 0.01 and lm["suggested_qty"] == 6  # ceil(0.64*10)=7 target - 1 on hand
    o = client.post("/api/orders/draft", json={"store_id": sid}).json()
    line = next(l for l in o["lines"] if l["sku"] == "LM-PC-ORIG-60")
    assert line["qty"] == 6 and "Sells ~0.6/day" in line["reason"]
    coke = next(l for l in o["lines"] if l["sku"] == "COKE-MISMO")
    assert "No sales history" in coke["reason"] and coke["qty"] == 10


def test_cashflow_score_is_explained_bounded_and_private(client, store, anon, ops):
    sid = store["id"]
    empty = client.get(f"/api/stores/{sid}/cashflow").json()
    assert 0 <= empty["score"] <= 100 and empty["band"] == "Building" and "not a credit decision" in empty["disclaimer"]
    assert sum(f["weight"] for f in empty["factors"]) == 100
    confirm(client, upload(client, sid, photo(930), kind="ledger").json()["id"], [{"sku": "COKE-MISMO", "qty": 2, "unit_price": 20}])
    after = client.get(f"/api/stores/{sid}/cashflow").json()
    assert after["score"] > empty["score"] and after["metrics"]["ledger_days_30d"] == 1 and after["metrics"]["sales_30d"] == 40
    assert all(0 <= f["score"] <= 1 and f["detail"] for f in after["factors"])
    # other merchants can't see it; staff can't either; operations can (and the portal shows it)
    from conftest import register
    other = register(anon, "rival3@test.ph", "Rival 3")
    assert anon.get(f"/api/stores/{sid}/cashflow", headers={"Authorization": f"Bearer {other['token']}"}).status_code == 404
    client.post(f"/api/stores/{sid}/members", json={"email": "st@test.ph", "name": "St", "password": "staff-pass-9"})
    st = anon.post("/api/auth/login", json={"email": "st@test.ph", "password": "staff-pass-9"}).json()["token"]
    assert anon.get(f"/api/stores/{sid}/cashflow", headers={"Authorization": f"Bearer {st}"}).status_code == 403
    assert ops.get(f"/api/stores/{sid}/cashflow").json()["score"] == after["score"]
    row = next(r for r in ops.get("/api/portal/overview").json()["stores"] if r["id"] == sid)
    assert row["cashflow_score"] == after["score"] and "units_per_day" in row
