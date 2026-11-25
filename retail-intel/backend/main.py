"""KWADERNO Retail Intelligence API.

Run:  uvicorn main:app --reload --port 8100      (from backend/)
Docs: http://localhost:8100/docs
Every endpoint except /api/health, /api/auth/register|login, signed /api/media links and the public store pages
(/api/shop/{slug}…) needs `Authorization: Bearer <token>`.
"""
from __future__ import annotations

import os
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

import auth
import insights
import services as svc
from db import Capture, Database, Product, Store, StoreMember, User, WholesaleOrder
from schemas import (AdjustIn, ConfirmCapture, CustomerOrderStatusIn, LoginIn, MemberIn, OrderDraftIn, OrderPatch, OrderStatusIn,
                     ProductIn, ProductPatch, PublicOrderIn, RegisterIn, ShopIn, StoreIn, SyncIn)
from vision_service import KINDS, VisionProvider, get_provider

MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "10")) * 1024 * 1024
MEDIA_PATH = re.compile(r"^(captures|thumbs)/[A-Za-z0-9._-]+$")


def create_app(database_url: str | None = None, upload_dir: str | None = None, vision: VisionProvider | None = None, seed: bool | None = None) -> FastAPI:
    db = Database(database_url)
    upload_dir = upload_dir or os.environ.get("UPLOAD_DIR") or os.path.join(os.path.dirname(__file__), "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    provider = vision or get_provider()
    do_seed = seed if seed is not None else os.environ.get("SEED_DEMO", "1") == "1"
    limiter = auth.RateLimiter(limit=int(os.environ.get("LOGIN_RATE_LIMIT", "8")), window=300)
    order_limiter = auth.RateLimiter(limit=int(os.environ.get("ORDER_RATE_LIMIT", "10")), window=600)  # public orders per device

    @asynccontextmanager
    async def lifespan(_app):
        db.create_all()
        if do_seed:
            from seed import seed_if_empty
            with db.Session() as s:
                seed_if_empty(s, upload_dir, provider)
        yield

    app = FastAPI(title="KWADERNO Retail Intelligence", version="1.1.0", lifespan=lifespan)
    app.state.db, app.state.upload_dir, app.state.vision, app.state.limiter = db, upload_dir, provider, limiter
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(svc.AppError)
    async def app_error(_req: Request, e: svc.AppError):
        return JSONResponse(status_code=e.status, content={"detail": e.message})

    @app.exception_handler(auth.AuthError)
    async def auth_error(_req: Request, e: auth.AuthError):
        return JSONResponse(status_code=e.status, content={"detail": e.message}, headers={"WWW-Authenticate": "Bearer"} if e.status == 401 else None)

    def session():
        yield from db.session()

    def bearer(authorization: str | None = Header(default=None)) -> str | None:
        if authorization and authorization.lower().startswith("bearer "):
            return authorization[7:].strip()
        return None

    def current_user(s: Session = Depends(session), token: str | None = Depends(bearer)) -> User:
        u = auth.user_for_token(s, token)
        s.info["user_id"] = u.id  # recorded on audit entries and stock movements
        return u

    def user_out(s: Session, u: User) -> dict:
        if u.role == "ops":
            stores = [{"id": st.id, "name": st.name, "barangay": st.barangay, "city": st.city, "role": "ops"} for st in s.scalars(select(Store).order_by(Store.name))]
        else:
            rows = s.execute(select(Store, StoreMember.role).join(StoreMember, StoreMember.store_id == Store.id).where(StoreMember.user_id == u.id).order_by(Store.name))
            stores = [{"id": st.id, "name": st.name, "barangay": st.barangay, "city": st.city, "role": role} for st, role in rows]
        return {"user": {"id": u.id, "email": u.email, "name": u.name, "role": u.role}, "stores": stores}

    # ---------- meta ----------
    @app.get("/api/health")
    def health():
        return {"ok": True, "vision_provider": provider.name, "distributors": svc.DISTRIBUTORS}

    # ---------- auth ----------
    @app.post("/api/auth/register", status_code=201)
    def register(body: RegisterIn, request: Request, s: Session = Depends(session)):
        limiter.check(f"register:{request.client.host if request.client else '-'}")
        email = body.email.strip().lower()
        if s.scalar(select(User.id).where(func.lower(User.email) == email)):
            raise HTTPException(409, "An account with this email already exists")
        u = User(email=email, name=body.name.strip(), password_hash=auth.hash_password(body.password), role="merchant")
        st = Store(name=body.store_name.strip(), barangay=body.barangay, city=body.city, owner_name=body.name.strip())
        s.add_all([u, st])
        s.flush()
        s.add(StoreMember(store_id=st.id, user_id=u.id, role="owner"))
        s.info["user_id"] = u.id
        svc.audit(s, "store_created", "store", st.id, st.id, name=st.name)
        token = auth.issue_token(s, u)
        s.commit()
        return {"token": token, **user_out(s, u)}

    @app.post("/api/auth/login")
    def login(body: LoginIn, request: Request, s: Session = Depends(session)):
        email = body.email.strip().lower()
        key = f"login:{email}:{request.client.host if request.client else '-'}"
        limiter.check(key)
        u = s.scalar(select(User).where(func.lower(User.email) == email))
        if not u or not u.active or not auth.verify_password(body.password, u.password_hash):
            raise HTTPException(401, "Wrong email or password")
        limiter.reset(key)
        token = auth.issue_token(s, u)
        s.commit()
        return {"token": token, **user_out(s, u)}

    @app.post("/api/auth/logout", status_code=204)
    def logout(token: str | None = Depends(bearer), s: Session = Depends(session)):
        if token:
            auth.revoke_token(s, token)
            s.commit()

    @app.get("/api/auth/me")
    def me(u: User = Depends(current_user), s: Session = Depends(session)):
        return user_out(s, u)

    # ---------- stores & members ----------
    @app.get("/api/stores")
    def list_stores(u: User = Depends(current_user), s: Session = Depends(session)):
        return user_out(s, u)["stores"]

    @app.post("/api/stores", status_code=201)
    def create_store(body: StoreIn, u: User = Depends(current_user), s: Session = Depends(session)):
        st = Store(**body.model_dump())
        s.add(st)
        s.flush()
        if u.role != "ops":
            s.add(StoreMember(store_id=st.id, user_id=u.id, role="owner"))
        svc.audit(s, "store_created", "store", st.id, st.id, name=st.name)
        s.commit()
        return {"id": st.id, **body.model_dump(), "role": "ops" if u.role == "ops" else "owner"}

    @app.get("/api/stores/{store_id}/members")
    def list_members(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        rows = s.execute(select(User, StoreMember.role).join(StoreMember, StoreMember.user_id == User.id).where(StoreMember.store_id == store_id).order_by(User.name))
        return [{"id": m.id, "name": m.name, "email": m.email, "role": role} for m, role in rows]

    @app.post("/api/stores/{store_id}/members", status_code=201)
    def add_member(store_id: int, body: MemberIn, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id, owner_only=True)
        email = body.email.strip().lower()
        m = s.scalar(select(User).where(func.lower(User.email) == email))
        if m is None:
            if not body.password:
                raise HTTPException(422, "Set a starting password for the new staff account")
            m = User(email=email, name=body.name.strip(), password_hash=auth.hash_password(body.password), role="merchant")
            s.add(m)
            s.flush()
        if s.scalar(select(StoreMember.id).where(StoreMember.store_id == store_id, StoreMember.user_id == m.id)):
            raise HTTPException(409, "Already a member of this store")
        s.add(StoreMember(store_id=store_id, user_id=m.id, role=body.role))
        svc.audit(s, "member_added", "store", store_id, store_id, member=m.email, role=body.role)
        s.commit()
        return {"id": m.id, "name": m.name, "email": m.email, "role": body.role}

    # ---------- products / inventory ----------
    def product_for(s: Session, u: User, product_id: int, owner_only: bool = False) -> Product:
        p = s.get(Product, product_id)
        if not p:
            raise HTTPException(404, "Product not found")
        auth.require_store(s, u, p.store_id, owner_only=owner_only)
        return p

    @app.get("/api/stores/{store_id}/products")
    def list_products(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        return [svc.product_out(p) for p in s.scalars(select(Product).where(Product.store_id == store_id).order_by(Product.name))]

    @app.post("/api/stores/{store_id}/products", status_code=201)
    def create_product(store_id: int, body: ProductIn, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        if svc.find_product(s, store_id, body.sku):
            raise HTTPException(409, "A product with this SKU already exists")
        p = svc.upsert_product(s, store_id, body.model_dump())
        s.commit()
        return svc.product_out(p)

    @app.patch("/api/products/{product_id}")
    def update_product(product_id: int, body: ProductPatch, u: User = Depends(current_user), s: Session = Depends(session)):
        p = product_for(s, u, product_id, owner_only=True)
        svc.patch_product(s, p, body.model_dump())
        s.commit()
        return svc.product_out(p)

    @app.post("/api/products/{product_id}/thumbnail")
    async def upload_thumbnail(product_id: int, file: UploadFile = File(...), u: User = Depends(current_user), s: Session = Depends(session)):
        p = product_for(s, u, product_id, owner_only=True)
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "Image too large")
        try:
            img = svc.image_checks.open_image(data)
        except svc.image_checks.InvalidImage as e:
            raise HTTPException(422, str(e))
        img = img.convert("RGB")
        img.thumbnail((256, 256))
        rel = f"thumbs/{p.id}-{svc.image_checks.hashlib.sha256(data).hexdigest()[:12]}.jpg"
        os.makedirs(os.path.join(upload_dir, "thumbs"), exist_ok=True)
        img.save(os.path.join(upload_dir, rel), "JPEG", quality=85)
        p.thumbnail_url = rel
        svc.audit(s, "thumbnail_updated", "product", p.id, p.store_id)
        s.commit()
        return svc.product_out(p)

    @app.post("/api/inventory/adjust")
    def adjust(body: AdjustIn, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, body.store_id)
        if not body.sku and not body.barcode:
            raise HTTPException(422, "Give a SKU or a barcode")
        p = svc.adjust(s, body.store_id, body.sku, body.barcode, body.delta, body.reason)
        s.commit()
        return svc.product_out(p)

    @app.get("/api/stores/{store_id}/lookup")
    def lookup(store_id: int, code: str = Query(min_length=1, max_length=64), u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        p = svc.find_product(s, store_id, code, code)
        if not p:
            raise HTTPException(404, "Not in this store's catalog")
        return svc.product_out(p)

    # ---------- captures ----------
    def capture_for(s: Session, u: User, cid: int) -> Capture:
        c = s.get(Capture, cid)
        if not c:
            raise HTTPException(404, "Capture not found")
        auth.require_store(s, u, c.store_id)
        return c

    @app.post("/api/captures", status_code=201)
    async def upload_capture(store_id: int = Form(...), kind: str = Form(...), client_id: str | None = Form(None),
                             file: UploadFile = File(...), u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        if kind not in KINDS:
            raise HTTPException(422, f"kind must be one of {', '.join(KINDS)}")
        if client_id is not None and not (8 <= len(client_id) <= 64):
            raise HTTPException(422, "client_id must be 8-64 characters")
        data = await file.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            raise HTTPException(413, "Image too large")
        if not data:
            raise HTTPException(422, "Empty file")
        c, _created = svc.ingest_capture(s, store_id, kind, data, client_id, provider, upload_dir)
        if c.store_id != store_id:  # a retried client_id from another store must not leak that capture
            raise HTTPException(409, "This upload id was already used")
        s.commit()
        return svc.capture_out(c)

    @app.get("/api/captures")
    def list_captures(store_id: int | None = None, status: str | None = None, limit: int = Query(100, le=500), u: User = Depends(current_user), s: Session = Depends(session)):
        q = select(Capture).order_by(Capture.id.desc()).limit(limit)
        if store_id:
            auth.require_store(s, u, store_id)
            q = q.where(Capture.store_id == store_id)
        else:
            ids = auth.store_ids(s, u)
            if ids is not None:
                q = q.where(Capture.store_id.in_(ids))
        if status:
            q = q.where(Capture.status == status)
        return [svc.capture_out(c) for c in s.scalars(q)]

    @app.get("/api/captures/{cid}")
    def get_capture(cid: int, u: User = Depends(current_user), s: Session = Depends(session)):
        return svc.capture_out(capture_for(s, u, cid))

    @app.post("/api/captures/{cid}/confirm")
    def confirm(cid: int, body: ConfirmCapture, u: User = Depends(current_user), s: Session = Depends(session)):
        c = capture_for(s, u, cid)
        if body.award_low_quality and u.role != "ops":
            raise HTTPException(403, "Only KELSON operations can award points for a flagged photo")
        c = svc.confirm_capture(s, c, [i.model_dump() for i in body.items], body.award_low_quality)
        s.commit()
        return svc.capture_out(c)

    @app.post("/api/captures/{cid}/reject")
    def reject(cid: int, reason: str = Form("Rejected by reviewer"), u: User = Depends(current_user), s: Session = Depends(session)):
        c = svc.reject_capture(s, capture_for(s, u, cid), reason)
        s.commit()
        return svc.capture_out(c)

    # ---------- media (signed, expiring links; photos are never public) ----------
    @app.get("/api/media/{path:path}")
    def media(path: str, exp: int = Query(...), sig: str = Query(..., min_length=8, max_length=64)):
        if not MEDIA_PATH.match(path) or not auth.verify_media(path, exp, sig):
            raise HTTPException(403, "Link expired or invalid")
        full = os.path.join(upload_dir, path)
        if not os.path.isfile(full):
            raise HTTPException(404, "Not found")
        return FileResponse(full, headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})

    # ---------- wholesale orders ----------
    def order_for(s: Session, u: User, oid: int) -> WholesaleOrder:
        o = svc.get_order(s, oid)
        auth.require_store(s, u, o.store_id)
        return o

    @app.get("/api/orders")
    def list_orders(store_id: int | None = None, status: str | None = None, u: User = Depends(current_user), s: Session = Depends(session)):
        q = select(WholesaleOrder).order_by(WholesaleOrder.id.desc())
        if store_id:
            auth.require_store(s, u, store_id)
            q = q.where(WholesaleOrder.store_id == store_id)
        else:
            ids = auth.store_ids(s, u)
            if ids is not None:
                q = q.where(WholesaleOrder.store_id.in_(ids))
        if status:
            q = q.where(WholesaleOrder.status == status)
        return [svc.order_out(o) for o in s.scalars(q)]

    @app.post("/api/orders/draft", status_code=201)
    def draft(body: OrderDraftIn, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, body.store_id)
        o = svc.draft_order(s, body.store_id, body.distributor)
        s.commit()
        return svc.order_out(o)

    @app.patch("/api/orders/{oid}")
    def patch_order(oid: int, body: OrderPatch, u: User = Depends(current_user), s: Session = Depends(session)):
        o = svc.patch_order(s, order_for(s, u, oid), body.model_dump())
        s.commit()
        return svc.order_out(o)

    @app.post("/api/orders/{oid}/status")
    def order_status(oid: int, body: OrderStatusIn, u: User = Depends(current_user), s: Session = Depends(session)):
        o = svc.set_order_status(s, order_for(s, u, oid), body.status)
        s.commit()
        return svc.order_out(o)

    # ---------- rewards ----------
    # ---------- online ordering ----------
    @app.get("/api/stores/{store_id}/shop")
    def get_shop(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        return svc.get_shop_settings(s, store_id)

    @app.put("/api/stores/{store_id}/shop")
    def put_shop(store_id: int, body: ShopIn, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id, owner_only=True)
        return svc.save_shop(s, store_id, body.model_dump())

    @app.get("/api/shop/{slug}")
    def shop_page(slug: str, s: Session = Depends(session)):
        return svc.public_catalog(s, slug)

    @app.post("/api/shop/{slug}/orders", status_code=201)
    def shop_order(slug: str, body: PublicOrderIn, request: Request, s: Session = Depends(session)):
        order_limiter.check(f"order:{request.client.host if request.client else '-'}")
        return svc.place_customer_order(s, slug, body.model_dump())

    @app.get("/api/shop/{slug}/orders/{code}")
    def shop_order_status(slug: str, code: str, t: str = Query(min_length=8, max_length=64), s: Session = Depends(session)):
        return svc.public_order_status(s, slug, code, t)

    @app.get("/api/stores/{store_id}/customer-orders")
    def customer_orders(store_id: int, status: str | None = None, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        return svc.list_customer_orders(s, store_id, status)

    @app.post("/api/customer-orders/{oid}/status")
    def customer_order_status(oid: int, body: CustomerOrderStatusIn, u: User = Depends(current_user), s: Session = Depends(session)):
        o = svc.get_customer_order(s, oid)
        auth.require_store(s, u, o.store_id)
        return svc.set_customer_order_status(s, o, body.status)

    @app.get("/api/stores/{store_id}/rewards")
    def rewards(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        return svc.rewards(s, store_id)

    # ---------- check-ins, forecast, cash-flow score ----------
    @app.get("/api/stores/{store_id}/checkins")
    def checkins(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        return insights.checkin_days(s, store_id)

    @app.get("/api/stores/{store_id}/forecast")
    def forecast(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id)
        return {"lead_days": insights.LEAD_DAYS, "cover_days": insights.COVER_DAYS, "history_days": insights.HISTORY_DAYS, "products": insights.forecast(s, store_id)}

    @app.get("/api/stores/{store_id}/cashflow")
    def cashflow(store_id: int, u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_store(s, u, store_id, owner_only=True)  # financial picture: owners and KELSON operations only
        return insights.cashflow(s, store_id)

    # ---------- offline sync ----------
    @app.post("/api/sync")
    def sync(body: SyncIn, u: User = Depends(current_user), s: Session = Depends(session)):
        role = auth.require_store(s, u, body.store_id)
        res = svc.apply_sync(s, body.store_id, [o.model_dump() for o in body.ops], role)
        s.commit()
        return {"results": res}

    # ---------- portal (KELSON operations only) ----------
    @app.get("/api/portal/overview")
    def overview(u: User = Depends(current_user), s: Session = Depends(session)):
        auth.require_ops(u)
        return svc.portal_overview(s)

    @app.get("/api/portal/audit")
    def audit_log(store_id: int | None = None, limit: int = Query(200, le=1000), u: User = Depends(current_user), s: Session = Depends(session)):
        if u.role != "ops":  # merchants see their own store's log only
            if not store_id:
                raise HTTPException(403, "Operations portal access only")
            auth.require_store(s, u, store_id, owner_only=True)
        return svc.audit_list(s, store_id, limit)

    return app


app = create_app()
