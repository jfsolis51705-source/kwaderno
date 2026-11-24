import io
import os
import random
import sys

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from main import create_app  # noqa: E402
from vision_service import MockVisionProvider  # noqa: E402


def register(c, email, store_name="Test Store", password="secret-pass-1"):
    r = c.post("/api/auth/register", json={"email": email, "password": password, "name": email.split("@")[0], "store_name": store_name, "barangay": "Culiat", "city": "Quezon City"})
    assert r.status_code == 201, r.text
    return r.json()


def make_ops(app, email="ops@test.ph", password="ops-pass-123"):
    import auth
    from db import User
    with app.state.db.Session() as s:
        s.add(User(email=email, name="Ops", password_hash=auth.hash_password(password), role="ops"))
        s.commit()


@pytest.fixture()
def app(tmp_path):
    return create_app(database_url=f"sqlite:///{tmp_path / 'test.db'}", upload_dir=str(tmp_path / "uploads"), vision=MockVisionProvider(), seed=False)


@pytest.fixture()
def anon(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client(app):
    """Logged in as the owner of 'Test Store'."""
    with TestClient(app) as c:
        c.me = register(c, "owner@test.ph")
        c.headers["Authorization"] = f"Bearer {c.me["token"]}"
        yield c


@pytest.fixture()
def ops(app, client):
    make_ops(app)
    with TestClient(app) as c:
        tok = c.post("/api/auth/login", json={"email": "ops@test.ph", "password": "ops-pass-123"}).json()["token"]
        c.headers["Authorization"] = f"Bearer {tok}"
        yield c


@pytest.fixture()
def store(client):
    st = client.me["stores"][0]
    for sku, name, brand, barcode, qty, reorder, price in [
        ("LM-PC-ORIG-60", "Lucky Me Pancit Canton Original 60g", "Lucky Me", "4800016644290", 10, 5, 18),
        ("COKE-MISMO", "Coca-Cola Mismo 290ml", "Coca-Cola", "4801981118502", 2, 6, 20),
        ("555-SARD-155", "555 Sardines in Tomato Sauce 155g", "555", None, 0, 4, 24),
    ]:
        r = client.post(f"/api/stores/{st['id']}/products", json={"sku": sku, "name": name, "brand": brand, "barcode": barcode,
                                                                 "qty_on_hand": qty, "reorder_level": reorder, "price": price, "cost": price * 0.85})
        assert r.status_code == 201, r.text
    return st


def photo(seed: int, size=(900, 700), blur: float = 0, fmt="JPEG", quality=90) -> bytes:
    """A detailed synthetic photo; different seeds give clearly different images."""
    rng = random.Random(seed)
    img = Image.new("RGB", size, (235, 235, 235))
    d = ImageDraw.Draw(img)
    for _ in range(160):
        x, y = rng.randint(0, size[0]), rng.randint(0, size[1])
        d.rectangle([x, y, x + rng.randint(10, 120), y + rng.randint(10, 120)], fill=tuple(rng.randint(0, 255) for _ in range(3)), outline=(0, 0, 0))
    if blur:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    buf = io.BytesIO()
    img.save(buf, fmt, quality=quality) if fmt == "JPEG" else img.save(buf, fmt)
    return buf.getvalue()


def recompress(data: bytes, scale=0.8, quality=60) -> bytes:
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img = img.resize((int(img.width * scale), int(img.height * scale)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def upload(client, store_id, data, kind="shelf", client_id=None):
    form = {"store_id": str(store_id), "kind": kind}
    if client_id:
        form["client_id"] = client_id
    return client.post("/api/captures", data=form, files={"file": ("photo.jpg", data, "image/jpeg")})
