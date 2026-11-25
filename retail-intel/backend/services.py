"""Business rules: capture verification, inventory, wholesale orders, rewards, offline sync and portal analytics."""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

import image_checks
import insights
from auth import sign_media
from db import (AuditLog, Capture, CustomerOrder, CustomerOrderLine, InventoryMovement, OrderLine, Product, RewardEntry, Shop,
                Store, SyncOp, WholesaleOrder, utcnow)
from vision_service import VisionProvider

POINTS = {"shelf": 10, "receipt": 15, "ledger": 15}
DISTRIBUTORS = ["Super8", "Suy Sing", "Other distributor"]
REDEMPTIONS = [
    {"id": "load20", "label": "₱20 mobile load", "points": 200},
    {"id": "delivery", "label": "Free delivery on next wholesale order", "points": 300},
    {"id": "load50", "label": "₱50 mobile load", "points": 500},
    {"id": "voucher100", "label": "₱100 grocery voucher", "points": 1000},
]


class AppError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def cents(pesos: float) -> int:
    return int(round(float(pesos) * 100))


# ---------- serializers ----------
def stock_status(p: Product) -> str:
    return "out" if p.qty_on_hand <= 0 else "low" if p.qty_on_hand <= p.reorder_level else "ok"


def product_out(p: Product) -> dict:
    return {"id": p.id, "store_id": p.store_id, "sku": p.sku, "name": p.name, "brand": p.brand, "variant": p.variant, "barcode": p.barcode,
            "price": p.price_cents / 100, "cost": p.cost_cents / 100, "reorder_level": p.reorder_level, "qty_on_hand": p.qty_on_hand,
            "status": stock_status(p), "thumbnail_url": sign_media(p.thumbnail_url) if p.thumbnail_url else None, "updated_at": p.updated_at.isoformat() if p.updated_at else None}


def capture_out(c: Capture) -> dict:
    return {"id": c.id, "store_id": c.store_id, "kind": c.kind, "client_id": c.client_id, "image_url": sign_media(c.image_path),
            "sha256": c.sha256, "phash": c.phash, "width": c.width, "height": c.height, "size_bytes": c.size_bytes, "blur_score": c.blur_score,
            "quality_ok": c.quality_ok, "quality_issues": c.quality_issues or [], "duplicate_of": c.duplicate_of, "status": c.status,
            "provider": c.provider, "items": c.items or [], "points_awarded": c.points_awarded, "checkin_bonus": getattr(c, "checkin_bonus", 0), "created_at": c.created_at.isoformat(),
            "verified_at": c.verified_at.isoformat() if c.verified_at else None}


def order_out(o: WholesaleOrder) -> dict:
    lines = [{"id": l.id, "product_id": l.product_id, "sku": l.sku, "name": l.name, "qty": l.qty, "unit_cost": l.unit_cost_cents / 100, "reason": l.reason,
              "line_total": l.qty * l.unit_cost_cents / 100} for l in o.lines]
    return {"id": o.id, "store_id": o.store_id, "distributor": o.distributor, "status": o.status, "note": o.note, "lines": lines,
            "total": sum(x["line_total"] for x in lines), "created_at": o.created_at.isoformat(),
            "submitted_at": o.submitted_at.isoformat() if o.submitted_at else None, "fulfilled_at": o.fulfilled_at.isoformat() if o.fulfilled_at else None}


def actor(s: Session) -> int | None:
    """The logged-in user for this request (set on the session by the API layer)."""
    return s.info.get("user_id")


def audit(s: Session, action: str, entity: str, entity_id: int | None, store_id: int | None, **detail) -> None:
    s.add(AuditLog(action=action, entity=entity, entity_id=entity_id, store_id=store_id, user_id=actor(s), detail=detail))


# ---------- lookups ----------
def get_store(s: Session, store_id: int) -> Store:
    st = s.get(Store, store_id)
    if not st:
        raise AppError(404, "Store not found")
    return st


def find_product(s: Session, store_id: int, sku: str | None = None, barcode: str | None = None) -> Product | None:
    if barcode:
        p = s.scalar(select(Product).where(Product.store_id == store_id, Product.barcode == barcode))
        if p:
            return p
    key = sku or barcode
    return s.scalar(select(Product).where(Product.store_id == store_id, Product.sku == key)) if key else None


# ---------- inventory ----------
def move(s: Session, p: Product, delta: int, reason: str, ref: str | None = None) -> InventoryMovement:
    new_qty = max(0, p.qty_on_hand + delta)
    real = new_qty - p.qty_on_hand
    p.qty_on_hand = new_qty
    p.updated_at = utcnow()
    m = InventoryMovement(store_id=p.store_id, product_id=p.id, delta=real, qty_after=new_qty, reason=reason, ref=ref, user_id=actor(s))
    s.add(m)
    return m


def adjust(s: Session, store_id: int, sku: str | None, barcode: str | None, delta: int, reason: str) -> Product:
    get_store(s, store_id)
    p = find_product(s, store_id, sku, barcode)
    if not p:
        raise AppError(404, "No product with that SKU/barcode in this store")
    move(s, p, delta, reason)
    audit(s, "stock_adjusted", "product", p.id, store_id, delta=delta, reason=reason, qty_after=p.qty_on_hand)
    return p


def upsert_product(s: Session, store_id: int, data: dict) -> Product:
    get_store(s, store_id)
    p = find_product(s, store_id, data["sku"])
    if p is None:
        p = Product(store_id=store_id, sku=data["sku"], name=data["name"], brand=data.get("brand"), variant=data.get("variant"), barcode=data.get("barcode"),
                    price_cents=cents(data.get("price", 0)), cost_cents=cents(data.get("cost", 0)), reorder_level=data.get("reorder_level", 5), qty_on_hand=0)
        s.add(p)
        s.flush()
        if data.get("qty_on_hand"):
            move(s, p, int(data["qty_on_hand"]), "manual", "opening")
        audit(s, "product_created", "product", p.id, store_id, sku=p.sku)
    else:
        patch_product(s, p, {k: v for k, v in data.items() if k not in ("sku", "qty_on_hand")})
    return p


def patch_product(s: Session, p: Product, data: dict) -> Product:
    for k in ("name", "brand", "variant", "barcode", "reorder_level"):
        if data.get(k) is not None:
            setattr(p, k, data[k])
    if data.get("price") is not None:
        p.price_cents = cents(data["price"])
    if data.get("cost") is not None:
        p.cost_cents = cents(data["cost"])
    p.updated_at = utcnow()
    audit(s, "product_updated", "product", p.id, p.store_id, fields=sorted(k for k, v in data.items() if v is not None))
    return p


# ---------- captures ----------
def ingest_capture(s: Session, store_id: int, kind: str, data: bytes, client_id: str | None, vision: VisionProvider, upload_dir: str) -> tuple[Capture, bool]:
    """Returns (capture, created). Duplicate photos are stored as rejected and never earn points."""
    get_store(s, store_id)
    if client_id:
        existing = s.scalar(select(Capture).where(Capture.client_id == client_id))
        if existing:
            return existing, False
    try:
        rep = image_checks.analyze(data)
    except image_checks.InvalidImage as e:
        raise AppError(422, str(e))
    dup = s.scalar(select(Capture).where(Capture.sha256 == rep.sha256, Capture.duplicate_of.is_(None)).order_by(Capture.id)) \
        or s.scalar(select(Capture).where(Capture.sha256 == rep.sha256).order_by(Capture.id))
    near = None
    if not dup:
        for cid, ph, orig in s.execute(select(Capture.id, Capture.phash, Capture.duplicate_of).order_by(Capture.id.desc()).limit(5000)):
            if image_checks.hamming(ph, rep.phash) <= image_checks.NEAR_DUP_DISTANCE:
                near = orig or cid  # always point at the original photo, not at an earlier copy
                break
    dup_id = dup.id if dup else near
    ext = "png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "webp" if data[8:12] == b"WEBP" else "jpg"
    rel = f"captures/{rep.sha256}.{ext}"
    full = os.path.join(upload_dir, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    if not os.path.exists(full):
        with open(full, "wb") as f:
            f.write(data)
    items: list[dict] = []
    provider = vision.name
    if dup_id is None:
        catalog = [{"sku": p.sku, "name": p.name, "brand": p.brand, "variant": p.variant, "price": p.price_cents / 100}
                   for p in s.scalars(select(Product).where(Product.store_id == store_id))]
        try:
            res = vision.extract(data, kind, catalog)
            items, provider = [i.as_dict() for i in res.items], res.provider
        except Exception as e:  # a failing vision API must not lose the photo; the merchant can type the items
            provider = f"{vision.name} (error: {type(e).__name__})"
    c = Capture(store_id=store_id, kind=kind, client_id=client_id, image_path=rel, sha256=rep.sha256, phash=rep.phash, width=rep.width,
                height=rep.height, size_bytes=rep.size_bytes, blur_score=rep.blur_score, quality_ok=rep.quality_ok, quality_issues=rep.issues,
                duplicate_of=dup_id, status="rejected" if dup_id else "pending_review", provider=provider, items=items)
    s.add(c)
    s.flush()
    audit(s, "capture_received", "capture", c.id, store_id, kind=kind, quality_issues=rep.issues, duplicate_of=dup_id,
          exact_duplicate=bool(dup), items=len(items), provider=provider)
    if dup_id:
        audit(s, "capture_rejected", "capture", c.id, store_id, reason="duplicate_photo", duplicate_of=dup_id)
    return c, True


def confirm_capture(s: Session, c: Capture, items: list[dict], award_low_quality: bool = False) -> Capture:
    if c.status != "pending_review":
        raise AppError(409, f"Capture is already {c.status}")
    if c.duplicate_of:
        raise AppError(409, "Duplicate photos cannot be confirmed")
    for it in items:
        p = find_product(s, c.store_id, it["sku"])
        if p is None:
            p = Product(store_id=c.store_id, sku=it["sku"], name=it.get("name") or it["sku"], brand=it.get("brand") or None,
                        variant=it.get("variant") or None, price_cents=cents(it.get("unit_price") or 0) if c.kind != "receipt" else 0,
                        cost_cents=cents(it.get("unit_price") or 0) if c.kind == "receipt" else 0, reorder_level=5, qty_on_hand=0)
            s.add(p)
            s.flush()
            audit(s, "product_created", "product", p.id, c.store_id, sku=p.sku, source=f"capture:{c.id}")
        qty = int(it["qty"])
        if c.kind == "shelf":  # a shelf count is an observation: set stock to what was counted
            move(s, p, qty - p.qty_on_hand, "shelf_count", f"capture:{c.id}")
        elif c.kind == "receipt":  # wholesale purchase: stock in, and remember the latest cost
            move(s, p, qty, "receipt", f"capture:{c.id}")
            if it.get("unit_price"):
                p.cost_cents = cents(it["unit_price"])
        else:  # handwritten sales ledger: stock out
            move(s, p, -qty, "ledger", f"capture:{c.id}")
    c.items = items
    c.status = "verified"
    c.verified_at = utcnow()
    eligible = c.quality_ok or award_low_quality
    if eligible and not s.scalar(select(RewardEntry).where(RewardEntry.capture_id == c.id)):
        pts = POINTS[c.kind]
        s.add(RewardEntry(store_id=c.store_id, points=pts, reason=f"Verified {c.kind} capture #{c.id}", capture_id=c.id))
        c.points_awarded = pts
    if c.kind in ("ledger", "shelf"):
        c.checkin_bonus = insights.award_checkin(s, c.store_id, c.created_at)
    audit(s, "capture_verified", "capture", c.id, c.store_id, items=len(items), points=c.points_awarded, checkin_bonus=getattr(c, "checkin_bonus", 0),
          quality_override=bool(award_low_quality and not c.quality_ok), no_points_reason=None if eligible else "low_quality")
    return c


def reject_capture(s: Session, c: Capture, reason: str) -> Capture:
    if c.status != "pending_review":
        raise AppError(409, f"Capture is already {c.status}")
    c.status = "rejected"
    audit(s, "capture_rejected", "capture", c.id, c.store_id, reason=reason[:200])
    return c


# ---------- wholesale orders ----------
def draft_order(s: Session, store_id: int, distributor: str) -> WholesaleOrder:
    get_store(s, store_id)
    o = WholesaleOrder(store_id=store_id, distributor=distributor, status="draft")
    s.add(o)
    rates = insights.sales_rates(s, store_id)
    for p in s.scalars(select(Product).where(Product.store_id == store_id).order_by(Product.name)):
        sg = insights.suggest(p, rates.get(p.id, 0.0))  # sales pace first, alert level when there is no history
        if sg:
            cost = p.cost_cents or int(p.price_cents * 0.85)
            o.lines.append(OrderLine(product_id=p.id, sku=p.sku, name=p.name, qty=sg[0], unit_cost_cents=cost, reason=sg[1]))
    s.flush()
    audit(s, "order_drafted", "order", o.id, store_id, distributor=distributor, lines=len(o.lines))
    return o


def get_order(s: Session, order_id: int) -> WholesaleOrder:
    o = s.get(WholesaleOrder, order_id)
    if not o:
        raise AppError(404, "Order not found")
    return o


def patch_order(s: Session, o: WholesaleOrder, data: dict) -> WholesaleOrder:
    if o.status != "draft":
        raise AppError(409, "Only draft orders can be edited")
    if data.get("distributor"):
        o.distributor = data["distributor"]
    if data.get("note") is not None:
        o.note = data["note"]
    if data.get("lines") is not None:
        by_pid = {l.product_id: l for l in o.lines}
        for ln in data["lines"]:
            p = s.get(Product, ln["product_id"])
            if not p or p.store_id != o.store_id:
                raise AppError(422, f"Product {ln['product_id']} is not in this store")
            cur = by_pid.get(p.id)
            if ln["qty"] == 0:
                if cur:
                    o.lines.remove(cur)
            elif cur:
                cur.qty = ln["qty"]
            else:
                o.lines.append(OrderLine(product_id=p.id, sku=p.sku, name=p.name, qty=ln["qty"], unit_cost_cents=p.cost_cents or int(p.price_cents * 0.85)))
    audit(s, "order_updated", "order", o.id, o.store_id, lines=len(o.lines))
    return o


TRANSITIONS = {"draft": {"submitted", "cancelled"}, "submitted": {"fulfilled", "cancelled"}}


def set_order_status(s: Session, o: WholesaleOrder, to: str) -> WholesaleOrder:
    if to not in TRANSITIONS.get(o.status, set()):
        raise AppError(409, f"Cannot move an order from {o.status} to {to}")
    if to == "submitted" and not any(l.qty > 0 for l in o.lines):
        raise AppError(422, "Add at least one item before submitting")
    o.status = to
    if to == "submitted":
        o.submitted_at = utcnow()
    if to == "fulfilled":
        o.fulfilled_at = utcnow()
        for l in o.lines:
            p = s.get(Product, l.product_id)
            if p:
                move(s, p, l.qty, "order", f"order:{o.id}")
                if l.unit_cost_cents:
                    p.cost_cents = l.unit_cost_cents
    audit(s, f"order_{to}", "order", o.id, o.store_id, distributor=o.distributor, total=sum(l.qty * l.unit_cost_cents for l in o.lines) / 100)
    return o


# ---------- rewards ----------
def rewards(s: Session, store_id: int) -> dict:
    get_store(s, store_id)
    rows = list(s.scalars(select(RewardEntry).where(RewardEntry.store_id == store_id).order_by(RewardEntry.id.desc())))
    bal = sum(r.points for r in rows)
    return {"store_id": store_id, "balance": bal, "points_per_capture": POINTS,
            "history": [{"id": r.id, "points": r.points, "reason": r.reason, "capture_id": r.capture_id, "created_at": r.created_at.isoformat()} for r in rows],
            "redemptions": [{**x, "can_redeem": bal >= x["points"], "points_short": max(0, x["points"] - bal)} for x in REDEMPTIONS]}


# ---------- offline sync ----------
def apply_sync(s: Session, store_id: int, ops: list[dict], role: str = "owner") -> list[dict]:
    get_store(s, store_id)
    out = []
    for op in ops:
        done = s.get(SyncOp, op["op_id"])
        if done:
            out.append({"op_id": op["op_id"], "ok": True, "duplicate": True, **done.result})
            continue
        try:
            with s.begin_nested():
                pl = op["payload"]
                if op["type"] == "adjust":
                    p = adjust(s, store_id, pl.get("sku"), pl.get("barcode"), int(pl["delta"]), pl.get("reason", "manual") if pl.get("reason") in ("barcode", "manual") else "manual")
                elif op["type"] == "product_upsert":
                    p = upsert_product(s, store_id, pl)
                else:
                    if role not in ("owner", "ops"):
                        raise AppError(403, "Only the store owner can edit product details")
                    p = find_product(s, store_id, pl.get("sku"))
                    if not p:
                        raise AppError(404, "Product not found")
                    patch_product(s, p, pl)
                s.flush()
                result = {"product": product_out(p)}
                s.add(SyncOp(op_id=op["op_id"], store_id=store_id, result=result))
            out.append({"op_id": op["op_id"], "ok": True, "duplicate": False, **result})
        except (AppError, KeyError, ValueError, TypeError) as e:
            out.append({"op_id": op["op_id"], "ok": False, "error": getattr(e, "message", str(e))})
    return out


# ---------- portal analytics ----------
def portal_overview(s: Session) -> dict:
    stores = list(s.scalars(select(Store).order_by(Store.name)))
    products = list(s.scalars(select(Product)))
    by_store = defaultdict(list)
    for p in products:
        by_store[p.store_id].append(p)
    pts = dict(s.execute(select(RewardEntry.store_id, func.sum(RewardEntry.points)).group_by(RewardEntry.store_id)).all())
    caps = list(s.scalars(select(Capture).order_by(Capture.id)))
    last_cap, pending = {}, defaultdict(int)
    for c in caps:
        last_cap[c.store_id] = c.created_at.isoformat()
        if c.status == "pending_review":
            pending[c.store_id] += 1
    rows = []
    for st in stores:
        ps = by_store[st.id]
        cf = insights.cashflow(s, st.id)
        velocity = sum(insights.sales_rates(s, st.id).values())
        rows.append({"id": st.id, "name": st.name, "barangay": st.barangay, "city": st.city, "skus": len(ps),
                     "cashflow_score": cf["score"], "cashflow_band": cf["band"], "units_per_day": round(velocity, 1), "checkin_streak": cf["metrics"]["checkin_streak"],
                     "ok": sum(stock_status(p) == "ok" for p in ps), "low": sum(stock_status(p) == "low" for p in ps),
                     "out": sum(stock_status(p) == "out" for p in ps), "stock_value": sum(p.qty_on_hand * p.cost_cents for p in ps) / 100,
                     "points": int(pts.get(st.id) or 0), "pending_captures": pending[st.id], "last_capture_at": last_cap.get(st.id)})
    names = {st.id: st.name for st in stores}
    alerts = sorted(({"store_id": p.store_id, "store": names.get(p.store_id), "product_id": p.id, "sku": p.sku, "name": p.name, "brand": p.brand,
                      "qty_on_hand": p.qty_on_hand, "reorder_level": p.reorder_level, "status": stock_status(p)} for p in products if stock_status(p) != "ok"),
                    key=lambda a: (a["status"] != "out", a["qty_on_hand"], a["store"] or ""))
    # share of shelf by brand from each store's latest verified shelf capture
    latest_shelf = {}
    for c in caps:
        if c.kind == "shelf" and c.status == "verified":
            latest_shelf[c.store_id] = c
    brand_units: dict[str, int] = defaultdict(int)
    for c in latest_shelf.values():
        for it in c.items or []:
            brand_units[(it.get("brand") or it.get("sku") or "Unknown").strip() or "Unknown"] += int(it.get("qty") or 0)
    total_units = sum(brand_units.values()) or 1
    sos = [{"brand": b, "units": u, "share": round(u / total_units, 4)} for b, u in sorted(brand_units.items(), key=lambda x: -x[1])]
    orders = list(s.scalars(select(WholesaleOrder).where(WholesaleOrder.status.in_(["draft", "submitted"])).order_by(WholesaleOrder.id.desc())))
    status_counts = defaultdict(int)
    for c in caps:
        status_counts[c.status] += 1
    return {"stores": rows, "totals": {"stores": len(stores), "skus": len(products), "low": sum(r["low"] for r in rows), "out": sum(r["out"] for r in rows),
                                       "captures": len(caps), "flagged": sum(1 for c in caps if c.duplicate_of or not c.quality_ok),
                                       "points": sum(r["points"] for r in rows), "open_orders": len(orders)},
            "captures_by_status": dict(status_counts), "alerts": alerts[:100], "share_of_shelf": sos,
            "shelf_captures_used": len(latest_shelf), "order_queue": [{**order_out(o), "store": names.get(o.store_id)} for o in orders]}


def audit_list(s: Session, store_id: int | None, limit: int) -> list[dict]:
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if store_id:
        q = q.where(AuditLog.store_id == store_id)
    return [{"id": a.id, "store_id": a.store_id, "user_id": a.user_id, "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "detail": a.detail,
             "created_at": a.created_at.isoformat()} for a in s.scalars(q)]


def to_dt(v: str | None) -> datetime | None:
    return datetime.fromisoformat(v) if v else None


# ---------- online ordering (public store page) ----------
CODE_CHARS = "ACDEFGHJKLMNPQRTUVWXY3479"  # no look-alikes (0/O, 1/I, 5/S, 8/B)
ORDER_FLOW = {"new": {"accepted", "cancelled"}, "accepted": {"ready", "cancelled"}, "ready": {"completed", "cancelled"}, "completed": set(), "cancelled": set()}


def slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:32].strip("-")
    return base if len(base) >= 3 else f"store-{base}".strip("-")


def shop_out(sh: Shop, store: Store) -> dict:
    return {"store_id": store.id, "slug": sh.slug, "enabled": sh.enabled, "pickup": sh.pickup, "delivery": sh.delivery,
            "delivery_fee": sh.delivery_fee_cents / 100, "min_order": sh.min_order_cents / 100, "note": sh.note, "path": f"/shop/{sh.slug}"}


def get_shop_settings(s: Session, store_id: int) -> dict:
    store = get_store(s, store_id)
    sh = s.get(Shop, store_id)
    if sh:
        return shop_out(sh, store)
    slug, n = slugify(store.name), 2
    while s.scalar(select(Shop).where(Shop.slug == slug)):
        slug, n = f"{slugify(store.name)[:34]}-{n}", n + 1
    return {"store_id": store_id, "slug": slug, "enabled": False, "pickup": True, "delivery": False, "delivery_fee": 0, "min_order": 0, "note": None, "path": None}


def save_shop(s: Session, store_id: int, data: dict) -> dict:
    store = get_store(s, store_id)
    sh = s.get(Shop, store_id)
    slug = data.get("slug") or (sh.slug if sh else get_shop_settings(s, store_id)["slug"])
    other = s.scalar(select(Shop).where(Shop.slug == slug, Shop.store_id != store_id))
    if other:
        raise AppError(409, "That link is already used by another store — choose another")
    if not data.get("pickup", True) and not data.get("delivery", False):
        raise AppError(400, "Offer pickup, delivery or both")
    if not sh:
        sh = Shop(store_id=store_id, slug=slug)
        s.add(sh)
    sh.slug, sh.enabled, sh.pickup, sh.delivery = slug, data.get("enabled", True), data.get("pickup", True), data.get("delivery", False)
    sh.delivery_fee_cents, sh.min_order_cents = cents(data.get("delivery_fee", 0)), cents(data.get("min_order", 0))
    sh.note = (data.get("note") or "").strip() or None
    audit(s, "shop.saved", "shop", store_id, store_id, slug=slug, enabled=sh.enabled)
    s.commit()
    return shop_out(sh, store)


def open_shop(s: Session, slug: str) -> tuple[Shop, Store]:
    sh = s.scalar(select(Shop).where(Shop.slug == slug))
    if not sh or not sh.enabled:
        raise AppError(404, "This store isn't taking online orders")
    return sh, get_store(s, sh.store_id)


def public_catalog(s: Session, slug: str) -> dict:
    sh, store = open_shop(s, slug)
    prods = s.scalars(select(Product).where(Product.store_id == store.id, Product.qty_on_hand > 0, Product.price_cents > 0).order_by(Product.name)).all()
    # no costs, SKUs or exact stock: customers only see what they can order
    items = [{"id": p.id, "name": p.name, "brand": p.brand, "variant": p.variant, "price": p.price_cents / 100, "max_qty": min(p.qty_on_hand, 99),
              "thumbnail_url": sign_media(p.thumbnail_url) if p.thumbnail_url else None} for p in prods]
    return {"store": {"name": store.name, "barangay": store.barangay, "city": store.city},
            "shop": {"pickup": sh.pickup, "delivery": sh.delivery, "delivery_fee": sh.delivery_fee_cents / 100, "min_order": sh.min_order_cents / 100, "note": sh.note},
            "products": items}


def shop_manifest(s: Session, slug: str) -> dict:
    """Web-app manifest for one store's order page, so customers can add it to their home screen under the store's name."""
    sh, store = open_shop(s, slug)
    return {"name": store.name, "short_name": store.name[:24], "description": f"Order from {store.name} for pickup or delivery.",
            "id": f"/shop/{sh.slug}", "start_url": f"/shop/{sh.slug}", "scope": f"/shop/{sh.slug}", "display": "standalone",
            "background_color": "#f8fafc", "theme_color": "#0e7c86",
            "icons": [{"src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png"}, {"src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
                      {"src": "/icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}


def _token_hash(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()


def customer_order_out(o: CustomerOrder, private: bool = True) -> dict:
    out = {"id": o.id, "code": o.code, "status": o.status, "fulfillment": o.fulfillment, "subtotal": o.subtotal_cents / 100, "delivery_fee": o.delivery_fee_cents / 100,
           "total": o.total_cents / 100, "created_at": o.created_at.isoformat(), "updated_at": o.updated_at.isoformat() if o.updated_at else None,
           "lines": [{"product_id": l.product_id, "name": l.name, "qty": l.qty, "price": l.price_cents / 100} for l in o.lines]}
    if private:  # the store sees who ordered; the public status page does not repeat it
        out.update({"customer_name": o.customer_name, "phone": o.phone, "address": o.address, "note": o.note})
    return out


def place_customer_order(s: Session, slug: str, data: dict) -> dict:
    sh, store = open_shop(s, slug)
    if data.get("website"):
        raise AppError(400, "Order could not be placed")
    ful = data["fulfillment"]
    if ful == "pickup" and not sh.pickup or ful == "delivery" and not sh.delivery:
        raise AppError(400, f"This store doesn't offer {ful}")
    address = (data.get("address") or "").strip()
    if ful == "delivery" and len(address) < 5:
        raise AppError(400, "Enter the delivery address")
    qty_by_id: dict[int, int] = defaultdict(int)
    for it in data["items"]:
        qty_by_id[it["product_id"]] += it["qty"]
    prods = {p.id: p for p in s.scalars(select(Product).where(Product.store_id == store.id, Product.id.in_(list(qty_by_id)))).all()}
    lines, subtotal = [], 0
    for pid, q in qty_by_id.items():
        p = prods.get(pid)
        if not p or p.price_cents <= 0:
            raise AppError(400, "An item in your cart is no longer available")
        if q > p.qty_on_hand:
            raise AppError(409, f"Only {p.qty_on_hand} {p.name} left — change the quantity")
        lines.append(CustomerOrderLine(product_id=p.id, name=p.name, qty=q, price_cents=p.price_cents))  # price from the store, never the browser
        subtotal += q * p.price_cents
    if subtotal < sh.min_order_cents:
        raise AppError(400, f"Minimum order is ₱{sh.min_order_cents / 100:,.2f}")
    fee = sh.delivery_fee_cents if ful == "delivery" else 0
    token = secrets.token_urlsafe(18)
    code = "".join(secrets.choice(CODE_CHARS) for _ in range(5))
    o = CustomerOrder(store_id=store.id, code=code, token_hash=_token_hash(token), customer_name=data["name"].strip(), phone=data["phone"].strip(), fulfillment=ful,
                      address=address or None, note=(data.get("note") or "").strip() or None, subtotal_cents=subtotal, delivery_fee_cents=fee, total_cents=subtotal + fee, lines=lines)
    s.add(o)
    s.flush()
    audit(s, "online_order.placed", "customer_order", o.id, store.id, code=code, total=o.total_cents)
    s.commit()
    return {**customer_order_out(o, private=False), "token": token, "store": store.name}


def public_order_status(s: Session, slug: str, code: str, token: str) -> dict:
    sh, store = open_shop(s, slug)
    o = s.scalar(select(CustomerOrder).where(CustomerOrder.store_id == store.id, CustomerOrder.code == code.upper()))
    if not o or not secrets.compare_digest(o.token_hash, _token_hash(token)):
        raise AppError(404, "Order not found")
    return {**customer_order_out(o, private=False), "store": store.name}


def list_customer_orders(s: Session, store_id: int, status: str | None) -> list[dict]:
    q = select(CustomerOrder).where(CustomerOrder.store_id == store_id)
    if status == "open":
        q = q.where(CustomerOrder.status.in_(["new", "accepted", "ready"]))
    elif status:
        q = q.where(CustomerOrder.status == status)
    return [customer_order_out(o) for o in s.scalars(q.order_by(CustomerOrder.created_at.desc()).limit(200)).all()]


def get_customer_order(s: Session, oid: int) -> CustomerOrder:
    o = s.get(CustomerOrder, oid)
    if not o:
        raise AppError(404, "Order not found")
    return o


def set_customer_order_status(s: Session, o: CustomerOrder, to: str) -> dict:
    if to not in ORDER_FLOW.get(o.status, set()):
        raise AppError(409, f"Can't change an order from {o.status} to {to}")
    if to == "completed":  # stock leaves the shelf now; check again, it may have sold in the store meanwhile
        for l in o.lines:
            p = s.get(Product, l.product_id) if l.product_id else None
            if p and l.qty > p.qty_on_hand:
                raise AppError(409, f"Only {p.qty_on_hand} {p.name} in stock — adjust the order or restock first")
        for l in o.lines:
            p = s.get(Product, l.product_id) if l.product_id else None
            if p:
                move(s, p, -l.qty, "online_order", ref=o.code)
    o.status = to
    o.updated_at = utcnow()
    audit(s, "online_order." + to, "customer_order", o.id, o.store_id, code=o.code)
    s.commit()
    return customer_order_out(o)


# ---------- operations portal: online ordering across all stores ----------
# Built for hundreds to thousands of stores: everything is aggregated in SQL and the store table is paged.
# Customers' names, phones and addresses stay with their store; the portal sees counts, money and status only.
ONLINE_SORTS = {"sales": "sales", "orders": "orders", "open": "open_now", "name": "name", "last": "last_order_at"}


def portal_online(s: Session, days: int = 30, q: str | None = None, sort: str = "sales", limit: int = 50, offset: int = 0) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    O = CustomerOrder
    done = O.status == "completed"
    is_open = O.status.in_(["new", "accepted", "ready"])
    agg = (select(O.store_id.label("store_id"), func.count(O.id).label("orders"), func.sum(case((done, 1), else_=0)).label("completed"),
                  func.sum(case((O.status == "cancelled", 1), else_=0)).label("cancelled"), func.sum(case((is_open, 1), else_=0)).label("open_now"),
                  func.coalesce(func.sum(case((done, O.total_cents), else_=0)), 0).label("sales_cents"),
                  func.sum(case((O.fulfillment == "delivery", 1), else_=0)).label("delivery"), func.max(O.created_at).label("last_order_at"))
           .where(O.created_at >= since).group_by(O.store_id).subquery())
    base = (select(Store.id, Store.name, Store.barangay, Store.city, Shop.slug, Shop.enabled, Shop.delivery.label("offers_delivery"),
                   func.coalesce(agg.c.orders, 0).label("orders"), func.coalesce(agg.c.completed, 0).label("completed"), func.coalesce(agg.c.cancelled, 0).label("cancelled"),
                   func.coalesce(agg.c.open_now, 0).label("open_now"), func.coalesce(agg.c.sales_cents, 0).label("sales"), agg.c.last_order_at)
            .join(Shop, Shop.store_id == Store.id).outerjoin(agg, agg.c.store_id == Store.id))
    if q:
        like = f"%{q.strip().lower()}%"
        base = base.where(or_(func.lower(Store.name).like(like), func.lower(Store.barangay).like(like), func.lower(Store.city).like(like), func.lower(Shop.slug).like(like)))
    sub = base.subquery()
    total_rows = s.scalar(select(func.count()).select_from(sub)) or 0
    col = getattr(sub.c, ONLINE_SORTS.get(sort, "sales"))
    order = col.asc() if sort == "name" else col.desc().nulls_last() if sort == "last" else col.desc()
    rows = s.execute(select(sub).order_by(order, sub.c.name).limit(limit).offset(offset)).mappings().all()
    stores = [{"id": r["id"], "name": r["name"], "barangay": r["barangay"], "city": r["city"], "slug": r["slug"], "enabled": bool(r["enabled"]),
               "offers_delivery": bool(r["offers_delivery"]), "orders": int(r["orders"]), "completed": int(r["completed"]), "cancelled": int(r["cancelled"]),
               "open_now": int(r["open_now"]), "sales": int(r["sales"]) / 100, "last_order_at": r["last_order_at"].isoformat() if r["last_order_at"] else None} for r in rows]
    t = s.execute(select(func.count(O.id), func.sum(case((done, 1), else_=0)), func.sum(case((O.status == "cancelled", 1), else_=0)),
                         func.coalesce(func.sum(case((done, O.total_cents), else_=0)), 0), func.sum(case((O.fulfillment == "delivery", 1), else_=0)),
                         func.count(func.distinct(O.store_id))).where(O.created_at >= since)).one()
    orders, completed, cancelled, sales, delivery, active = (int(x or 0) for x in t)
    open_now = s.scalar(select(func.count(O.id)).where(is_open)) or 0
    day = func.date(O.created_at)
    daily = [{"day": str(d), "orders": int(n), "sales": int(c or 0) / 100}
             for d, n, c in s.execute(select(day, func.count(O.id), func.sum(case((done, O.total_cents), else_=0))).where(O.created_at >= since).group_by(day).order_by(day)).all()]
    recent = s.execute(select(O.code, O.status, O.fulfillment, O.total_cents, O.created_at, Store.name).join(Store, Store.id == O.store_id)
                       .order_by(O.created_at.desc()).limit(20)).all()
    return {"days": days, "totals": {"stores": s.scalar(select(func.count(Store.id))) or 0, "shops": s.scalar(select(func.count()).select_from(Shop)) or 0,
                                     "shops_open": s.scalar(select(func.count()).select_from(Shop).where(Shop.enabled.is_(True))) or 0, "active_stores": active,
                                     "orders": orders, "completed": completed, "cancelled": cancelled, "open_now": open_now, "sales": sales / 100,
                                     "avg_order": round(sales / 100 / completed, 2) if completed else 0, "delivery_share": round(delivery / orders, 3) if orders else 0,
                                     "completion_rate": round(completed / orders, 3) if orders else 0},
            "daily": daily, "stores": stores, "total_rows": total_rows, "limit": limit, "offset": offset,
            "recent": [{"code": c, "status": st, "fulfillment": f, "total": tc / 100, "created_at": at.isoformat(), "store": n} for c, st, f, tc, at, n in recent]}
