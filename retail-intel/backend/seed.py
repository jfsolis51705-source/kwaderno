"""Demo data so the portal is useful the moment it starts. Runs only on an empty database (SEED_DEMO=1)."""
from __future__ import annotations

import io
import random

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.orm import Session

import services as svc
import auth
from db import Store, StoreMember, User
from vision_service import REFERENCE_SKUS

STORES = [
    ("Aling Nena Sari-sari", "Culiat", "Quezon City", "Nena"),
    ("Mang Ben Store", "Project 6", "Quezon City", "Ben"),
    ("Tindahan ni Rosa", "Bagong Pag-asa", "Quezon City", "Rosa"),
    ("Lito Mini Mart", "Tenejero", "Balanga City", "Lito"),
]
# Demo accounts (password for all: DEMO_PASSWORD). Never enable SEED_DEMO in production.
DEMO_PASSWORD = "demo1234"
OPS_EMAIL = "ops@demo.kwaderno.ph"


def demo_photo(seed: int, kind: str) -> bytes:
    """A synthetic, sharp 'shelf' or 'receipt' image (unique per seed so it is never a duplicate)."""
    rng = random.Random(seed)
    img = Image.new("RGB", (800, 600), (245, 245, 240) if kind != "shelf" else (230, 232, 236))
    d = ImageDraw.Draw(img)
    if kind == "shelf":
        for row in range(4):
            y = 40 + row * 140
            d.rectangle([20, y + 118, 780, y + 126], fill=(120, 90, 60))
            x = 30
            while x < 760:
                w = rng.randint(40, 90)
                d.rectangle([x, y + rng.randint(10, 40), x + w, y + 116], fill=tuple(rng.randint(30, 230) for _ in range(3)), outline=(20, 20, 20))
                x += w + rng.randint(4, 12)
    else:
        for i in range(22):
            y = 30 + i * 25
            d.line([40, y, 40 + rng.randint(200, 700), y], fill=(40, 40, 40), width=2)
            d.text((50, y - 18), f"{rng.randint(1, 24)} x item {rng.randint(100, 999)}  {rng.randint(5, 90)}.00", fill=(10, 10, 10))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def seed_if_empty(s: Session, upload_dir: str, vision) -> None:
    if s.scalar(select(Store.id).limit(1)):
        return
    rng = random.Random(42)
    pw = auth.hash_password(DEMO_PASSWORD)
    s.add(User(email=OPS_EMAIL, name="KELSON Operations", password_hash=pw, role="ops"))
    stores = []
    for name, brgy, city, owner in STORES:
        st = Store(name=name, barangay=brgy, city=city, owner_name=owner)
        u = User(email=f"{owner.lower()}@demo.kwaderno.ph", name=owner, password_hash=pw, role="merchant")
        s.add_all([st, u])
        s.flush()
        s.add(StoreMember(store_id=st.id, user_id=u.id, role="owner"))
        stores.append(st)
        for i, ref in enumerate(rng.sample(REFERENCE_SKUS, 14)):
            svc.upsert_product(s, st.id, {"sku": ref["sku"], "name": ref["name"], "brand": ref["brand"], "variant": ref["variant"],
                                          "barcode": f"480{st.id:02d}{i:07d}", "price": ref["price"], "cost": round(ref["price"] * 0.85, 2),
                                          "reorder_level": rng.choice([3, 5, 6, 10]), "qty_on_hand": rng.choice([0, 1, 2, 4, 8, 12, 20, 30])})
    s.flush()
    # one verified shelf photo per store (feeds share-of-shelf) and one pending receipt to review
    for n, st in enumerate(stores):
        c, _ = svc.ingest_capture(s, st.id, "shelf", demo_photo(1000 + n, "shelf"), None, vision, upload_dir)
        svc.confirm_capture(s, c, c.items)
        svc.ingest_capture(s, st.id, "receipt", demo_photo(2000 + n, "receipt"), None, vision, upload_dir)
    # a duplicate attempt, so the verification log shows the anti-fraud check
    svc.ingest_capture(s, stores[0].id, "shelf", demo_photo(1000, "shelf"), None, vision, upload_dir)
    # a draft and a submitted wholesale order
    svc.draft_order(s, stores[0].id, "Super8")
    o = svc.draft_order(s, stores[1].id, "Suy Sing")
    if o.lines:
        svc.set_order_status(s, o, "submitted")
    s.commit()
