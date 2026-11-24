"""Daily check-ins, predictive restock and the cash-flow readiness score.

All three are derived only from data the merchant already produces (photos of the ledger and shelves, stock changes,
orders), so nothing about their daily routine has to change.
"""
from __future__ import annotations

import math
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from db import Capture, InventoryMovement, Product, RewardEntry, WholesaleOrder

TZ = timezone(timedelta(hours=8))  # Philippines (no DST)
CHECKIN_BONUS = 10
STREAK_BONUS = 30  # every 7 complete days in a row
LEAD_DAYS = int(os.environ.get("RESTOCK_LEAD_DAYS", "3"))     # days between ordering and receiving
COVER_DAYS = int(os.environ.get("RESTOCK_COVER_DAYS", "7"))   # days of sales a delivery should cover
HISTORY_DAYS = 14
OUTFLOW_REASONS = ("ledger", "barcode", "manual", "shelf_count")


def local_day(dt: datetime) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ).date()


def today() -> date:
    return datetime.now(TZ).date()


# ---------- daily dual-capture check-in ----------
def checkin_days(s: Session, store_id: int, days: int = 30) -> dict:
    start = today() - timedelta(days=days - 1)
    by_day: dict[date, set[str]] = defaultdict(set)
    for kind, created in s.execute(select(Capture.kind, Capture.created_at).where(Capture.store_id == store_id, Capture.status == "verified", Capture.kind.in_(["ledger", "shelf"]))):
        d = local_day(created)
        if d >= start:
            by_day[d].add(kind)
    rows = [{"date": (start + timedelta(days=i)).isoformat(), "ledger": "ledger" in by_day[start + timedelta(days=i)],
             "shelf": "shelf" in by_day[start + timedelta(days=i)]} for i in range(days)]
    for r in rows:
        r["complete"] = r["ledger"] and r["shelf"]
    streak = 0
    for r in reversed(rows):
        if r["complete"]:
            streak += 1
        elif r["date"] == today().isoformat():
            continue  # today isn't over yet
        else:
            break
    t = rows[-1]
    return {"today": t, "streak": streak, "days": rows, "complete_days": sum(r["complete"] for r in rows),
            "bonus": {"per_day": CHECKIN_BONUS, "every_7_days": STREAK_BONUS}}


def award_checkin(s: Session, store_id: int, when: datetime) -> int:
    """Called after a ledger or shelf capture is verified. Awards the daily bonus once when both exist for that day."""
    d = local_day(when)
    kinds = {k for k, c in s.execute(select(Capture.kind, Capture.created_at).where(Capture.store_id == store_id, Capture.status == "verified", Capture.kind.in_(["ledger", "shelf"]))) if local_day(c) == d}
    s.flush()
    if kinds != {"ledger", "shelf"}:
        return 0
    ref = f"checkin:{store_id}:{d.isoformat()}"
    if s.scalar(select(RewardEntry.id).where(RewardEntry.ref == ref)):
        return 0
    pts = CHECKIN_BONUS
    s.add(RewardEntry(store_id=store_id, points=CHECKIN_BONUS, reason=f"Daily check-in {d.isoformat()} (ledger + shelf)", ref=ref))
    s.flush()
    streak = checkin_days(s, store_id, 60)["streak"]
    if streak and streak % 7 == 0:
        sref = f"streak:{store_id}:{d.isoformat()}"
        if not s.scalar(select(RewardEntry.id).where(RewardEntry.ref == sref)):
            s.add(RewardEntry(store_id=store_id, points=STREAK_BONUS, reason=f"{streak}-day check-in streak", ref=sref))
            pts += STREAK_BONUS
    return pts


# ---------- predictive restock ----------
def sales_rates(s: Session, store_id: int, days: int = HISTORY_DAYS) -> dict[int, float]:
    """Units per day leaving stock (sales in the ledger, scans/manual decreases, shelf counts lower than before)."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    out: dict[int, int] = defaultdict(int)
    for pid, delta in s.execute(select(InventoryMovement.product_id, InventoryMovement.delta).where(
            InventoryMovement.store_id == store_id, InventoryMovement.created_at >= since, InventoryMovement.delta < 0, InventoryMovement.reason.in_(OUTFLOW_REASONS))):
        out[pid] += -delta
    return {pid: units / days for pid, units in out.items()}


def suggest(p: Product, rate: float) -> tuple[int, str] | None:
    """Quantity to order for one product, with the reason shown to the merchant."""
    if rate > 0:
        target = math.ceil(rate * (LEAD_DAYS + COVER_DAYS))
        days_left = p.qty_on_hand / rate
        if days_left > LEAD_DAYS + 1 and p.qty_on_hand > p.reorder_level:
            return None
        qty = max(target - p.qty_on_hand, 1)
        return qty, f"Sells ~{rate:.1f}/day, {days_left:.0f} day(s) left — covers {LEAD_DAYS + COVER_DAYS} days"
    if p.qty_on_hand <= p.reorder_level:  # no sales history yet: fall back to the alert level
        return max(p.reorder_level * 2 - p.qty_on_hand, 1), "No sales history yet — refills to twice the alert level"
    return None


def forecast(s: Session, store_id: int) -> list[dict]:
    rates = sales_rates(s, store_id)
    rows = []
    for p in s.scalars(select(Product).where(Product.store_id == store_id).order_by(Product.name)):
        r = rates.get(p.id, 0.0)
        sg = suggest(p, r)
        rows.append({"product_id": p.id, "sku": p.sku, "name": p.name, "qty_on_hand": p.qty_on_hand, "per_day": round(r, 2),
                     "days_left": round(p.qty_on_hand / r, 1) if r else None, "suggested_qty": sg[0] if sg else 0, "reason": sg[1] if sg else None})
    return rows


# ---------- cash-flow readiness score ----------
DISCLAIMER = ("Indicative only. Built from the store's own photos and stock records in KWADERNO. "
              "It is not a credit decision; any lender must do its own checks and get the merchant's consent before using it.")


def cashflow(s: Session, store_id: int) -> dict:
    now = datetime.now(timezone.utc)
    caps = list(s.scalars(select(Capture).where(Capture.store_id == store_id)))
    verified = [c for c in caps if c.status == "verified"]
    t30 = today() - timedelta(days=29)
    ledger_days = {local_day(c.created_at) for c in verified if c.kind == "ledger" and local_day(c.created_at) >= t30}
    sales_30 = sum(int(i.get("qty") or 0) * float(i.get("unit_price") or 0) for c in verified if c.kind == "ledger" and local_day(c.created_at) >= t30 for i in (c.items or []))
    daily_sales = sales_30 / max(1, len(ledger_days)) if ledger_days else 0.0
    stock_value = sum(p.qty_on_hand * p.cost_cents for p in s.scalars(select(Product).where(Product.store_id == store_id))) / 100
    fulfilled = s.scalars(select(WholesaleOrder).where(WholesaleOrder.store_id == store_id, WholesaleOrder.status == "fulfilled")).all()
    fulfilled_60 = [o for o in fulfilled if o.fulfilled_at and (o.fulfilled_at if o.fulfilled_at.tzinfo else o.fulfilled_at.replace(tzinfo=timezone.utc)) >= now - timedelta(days=60)]
    flagged = sum(1 for c in caps if c.duplicate_of or not c.quality_ok)
    first = min((c.created_at for c in caps), default=None)
    tenure = (now - (first if first and first.tzinfo else (first or now).replace(tzinfo=timezone.utc))).days if first else 0
    streak = checkin_days(s, store_id, 60)["streak"]
    weekly_sales = daily_sales * 7
    factors = [
        {"key": "consistency", "label": "Sales recorded regularly", "weight": 35, "score": min(1.0, len(ledger_days) / 20),
         "detail": f"{len(ledger_days)} of the last 30 days have a verified sales-ledger photo (20+ is full marks)"},
        {"key": "stock_cover", "label": "Stock on hand vs. sales", "weight": 20, "score": min(1.0, stock_value / weekly_sales) if weekly_sales else 0.0,
         "detail": f"₱{stock_value:,.0f} of stock at cost vs. ~₱{weekly_sales:,.0f} sales a week" if weekly_sales else "No recorded sales yet"},
        {"key": "restock", "label": "Restocks through wholesale orders", "weight": 15, "score": min(1.0, len(fulfilled_60) / 4),
         "detail": f"{len(fulfilled_60)} wholesale order(s) received in 60 days (4+ is full marks)"},
        {"key": "data_quality", "label": "Clear, original photos", "weight": 15, "score": (1 - flagged / len(caps)) if caps else 0.0,
         "detail": f"{flagged} of {len(caps)} photo(s) flagged as duplicate or low quality"},
        {"key": "tenure", "label": "Time using KWADERNO", "weight": 15, "score": min(1.0, tenure / 90),
         "detail": f"{tenure} day(s) since the first photo (90+ is full marks); current check-in streak {streak} day(s)"},
    ]
    score = round(sum(f["weight"] * f["score"] for f in factors))
    for f in factors:
        f["points"] = round(f["weight"] * f["score"], 1)
        f["score"] = round(f["score"], 3)
    band = "Strong" if score >= 70 else "Fair" if score >= 40 else "Building"
    tips = [f["label"] for f in sorted(factors, key=lambda f: f["weight"] * (1 - f["score"]), reverse=True)[:2] if f["score"] < 1]
    return {"store_id": store_id, "score": score, "band": band, "factors": factors,
            "metrics": {"avg_daily_sales": round(daily_sales, 2), "sales_30d": round(sales_30, 2), "ledger_days_30d": len(ledger_days),
                        "stock_value": round(stock_value, 2), "orders_received_60d": len(fulfilled_60), "checkin_streak": streak},
            "improve": tips, "disclaimer": DISCLAIMER, "computed_at": now.isoformat()}
