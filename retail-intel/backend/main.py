"""KWADERNO Retail Intelligence API.

Run:  uvicorn main:app --reload --port 8100      (from backend/)
Docs: http://localhost:8100/docs
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

import services as svc
from db import Capture, Database, Product, Store, WholesaleOrder
from schemas import (AdjustIn, ConfirmCapture, OrderDraftIn, OrderPatch, OrderStatusIn, ProductIn, ProductPatch, StoreIn,
                     SyncIn)
from vision_service import KINDS, VisionProvider, get_provider

MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "10")) * 1024 * 1024


def create_app(database_url: str | None = None, upload_dir: str | None = None, vision: VisionProvider | None = None, seed: bool | None = None) -> FastAPI:
    db = Database(database_url)
    upload_dir = upload_dir or os.environ.get("UPLOAD_DIR") or os.path.join(os.path.dirname(__file__), "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    provider = vision or get_provider()
    do_seed = seed if seed is not None else os.environ.get("SEED_DEMO", "1") == "1"

    @asynccontextmanager
    async def lifespan(_app):
        db.create_all()
        if do_seed:
            from seed import seed_if_empty
            with db.Session() as s:
                seed_if_empty(s, upload_dir, provider)
        yield

    app = FastAPI(title="KWADERNO Retail Intelligence", version="1.0.0", lifespan=lifespan)
    app.state.db, app.state.upload_dir, app.state.vision = db, upload_dir, provider
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])
    app.mount("/media", StaticFiles(directory=upload_dir), name="media")

    @app.exception_handler(svc.AppError)
    async def app_error(_req: Request, e: svc.AppError):
        return JSONResponse(status_code=e.status, content={"detail": e.message})

    def session():
        yield from db.session()

    def commit(s: Session):
        s.commit()

    # ---------- meta ----------
    @app.get("/api/health")
    def health():
        return {"ok": True, "vision_provider": provider.name, "distributors": svc.DISTRIBUTORS}

    # ---------- stores ----------
    @app.get("/api/stores")
    def list_stores(s: Session = Depends(session)):
        return [{"id": st.id, "name": st.name, "barangay": st.barangay, "city": st.city, "owner_name": st.owner_name} for st in s.scalars(select(Store).order_by(Store.name))]

    @app.post("/api/stores", status_code=201)
    def create_store(body: StoreIn, s: Session = Depends(session)):
        st = Store(**body.model_dump())
        s.add(st)
        s.flush()
        svc.audit(s, "store_created", "store", st.id, st.id, name=st.name)
        s.commit()
        return {"id": st.id, **body.model_dump()}

    # ---------- products / inventory ----------
    @app.get("/api/stores/{store_id}/products")
    def list_products(store_id: int, s: Session = Depends(session)):
        svc.get_store(s, store_id)
        return [svc.product_out(p) for p in s.scalars(select(Product).where(Product.store_id == store_id).order_by(Product.name))]

    @app.post("/api/stores/{store_id}/products", status_code=201)
    def create_product(store_id: int, body: ProductIn, s: Session = Depends(session)):
        if svc.find_product(s, store_id, body.sku):
            raise HTTPException(409, "A product with this SKU already exists")
        p = svc.upsert_product(s, store_id, body.model_dump())
        s.commit()
        return svc.product_out(p)

    @app.patch("/api/products/{product_id}")
    def update_product(product_id: int, body: ProductPatch, s: Session = Depends(session)):
        p = s.get(Product, product_id)
        if not p:
            raise HTTPException(404, "Product not found")
        svc.patch_product(s, p, body.model_dump())
        s.commit()
        return svc.product_out(p)

    @app.post("/api/products/{product_id}/thumbnail")
    async def upload_thumbnail(product_id: int, file: UploadFile = File(...), s: Session = Depends(session)):
        p = s.get(Product, product_id)
        if not p:
            raise HTTPException(404, "Product not found")
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
        p.thumbnail_url = "/media/" + rel
        svc.audit(s, "thumbnail_updated", "product", p.id, p.store_id)
        s.commit()
        return svc.product_out(p)

    @app.post("/api/inventory/adjust")
    def adjust(body: AdjustIn, s: Session = Depends(session)):
        if not body.sku and not body.barcode:
            raise HTTPException(422, "Give a SKU or a barcode")
        p = svc.adjust(s, body.store_id, body.sku, body.barcode, body.delta, body.reason)
        s.commit()
        return svc.product_out(p)

    @app.get("/api/stores/{store_id}/lookup")
    def lookup(store_id: int, code: str = Query(min_length=1, max_length=64), s: Session = Depends(session)):
        p = svc.find_product(s, store_id, code, code)
        if not p:
            raise HTTPException(404, "Not in this store's catalog")
        return svc.product_out(p)

    # ---------- captures ----------
    @app.post("/api/captures", status_code=201)
    async def upload_capture(store_id: int = Form(...), kind: str = Form(...), client_id: str | None = Form(None),
                             file: UploadFile = File(...), s: Session = Depends(session)):
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
        s.commit()
        return svc.capture_out(c)

    @app.get("/api/captures")
    def list_captures(store_id: int | None = None, status: str | None = None, limit: int = Query(100, le=500), s: Session = Depends(session)):
        q = select(Capture).order_by(Capture.id.desc()).limit(limit)
        if store_id:
            q = q.where(Capture.store_id == store_id)
        if status:
            q = q.where(Capture.status == status)
        return [svc.capture_out(c) for c in s.scalars(q)]

    def capture_or_404(s: Session, cid: int) -> Capture:
        c = s.get(Capture, cid)
        if not c:
            raise HTTPException(404, "Capture not found")
        return c

    @app.get("/api/captures/{cid}")
    def get_capture(cid: int, s: Session = Depends(session)):
        return svc.capture_out(capture_or_404(s, cid))

    @app.post("/api/captures/{cid}/confirm")
    def confirm(cid: int, body: ConfirmCapture, s: Session = Depends(session)):
        c = svc.confirm_capture(s, capture_or_404(s, cid), [i.model_dump() for i in body.items], body.award_low_quality)
        s.commit()
        return svc.capture_out(c)

    @app.post("/api/captures/{cid}/reject")
    def reject(cid: int, reason: str = Form("Rejected by reviewer"), s: Session = Depends(session)):
        c = svc.reject_capture(s, capture_or_404(s, cid), reason)
        s.commit()
        return svc.capture_out(c)

    # ---------- wholesale orders ----------
    @app.get("/api/orders")
    def list_orders(store_id: int | None = None, status: str | None = None, s: Session = Depends(session)):
        q = select(WholesaleOrder).order_by(WholesaleOrder.id.desc())
        if store_id:
            q = q.where(WholesaleOrder.store_id == store_id)
        if status:
            q = q.where(WholesaleOrder.status == status)
        return [svc.order_out(o) for o in s.scalars(q)]

    @app.post("/api/orders/draft", status_code=201)
    def draft(body: OrderDraftIn, s: Session = Depends(session)):
        o = svc.draft_order(s, body.store_id, body.distributor)
        s.commit()
        return svc.order_out(o)

    @app.patch("/api/orders/{oid}")
    def patch_order(oid: int, body: OrderPatch, s: Session = Depends(session)):
        o = svc.patch_order(s, svc.get_order(s, oid), body.model_dump())
        s.commit()
        return svc.order_out(o)

    @app.post("/api/orders/{oid}/status")
    def order_status(oid: int, body: OrderStatusIn, s: Session = Depends(session)):
        o = svc.set_order_status(s, svc.get_order(s, oid), body.status)
        s.commit()
        return svc.order_out(o)

    # ---------- rewards ----------
    @app.get("/api/stores/{store_id}/rewards")
    def rewards(store_id: int, s: Session = Depends(session)):
        return svc.rewards(s, store_id)

    # ---------- offline sync ----------
    @app.post("/api/sync")
    def sync(body: SyncIn, s: Session = Depends(session)):
        res = svc.apply_sync(s, body.store_id, [o.model_dump() for o in body.ops])
        s.commit()
        return {"results": res}

    # ---------- portal ----------
    @app.get("/api/portal/overview")
    def overview(s: Session = Depends(session)):
        return svc.portal_overview(s)

    @app.get("/api/portal/audit")
    def audit_log(store_id: int | None = None, limit: int = Query(200, le=1000), s: Session = Depends(session)):
        return svc.audit_list(s, store_id, limit)

    return app


app = create_app()
