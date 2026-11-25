"""Social sharing for store pages: link previews (Open Graph) and a picture card for Facebook, Messenger, Viber, TikTok and X.

Social apps don't run the web app's JavaScript, so a shared link (/s/<store> or /s/<store>/p/<product>) is a tiny
server page carrying the preview tags; people who open it go straight on to the order page.
"""
from __future__ import annotations

import html
import io
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy.orm import Session

import auth
import services as svc
from db import Product

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/Library/Fonts", "C:/Windows/Fonts"]


@lru_cache(maxsize=8)
def _font(size: int, bold: bool = True):
    for d in FONT_DIRS:
        for name in (("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "arialbd.ttf") if bold else ("DejaVuSans.ttf", "Arial.ttf", "arial.ttf")):
            p = os.path.join(d, name)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def public_base(request) -> str:
    """Absolute site address for preview tags. Set PUBLIC_URL in production (e.g. https://order.kwaderno.ph)."""
    env = os.environ.get("PUBLIC_URL", "").rstrip("/")
    if env:
        return env
    h = request.headers
    host = h.get("x-forwarded-host") or h.get("host") or "localhost"
    proto = h.get("x-forwarded-proto") or request.url.scheme
    return f"{proto}://{host}"


def _fit(d: ImageDraw.ImageDraw, text: str, font, width: int) -> str:
    if d.textlength(text, font=font) <= width:
        return text
    while text and d.textlength(text + "…", font=font) > width:
        text = text[:-1]
    return text + "…"


def store_card_png(s: Session, slug: str) -> bytes:
    """1200×630 picture for link previews: store name, place, how to order and a few items with prices."""
    cat = svc.public_catalog(s, slug)
    st, sh, items = cat["store"], cat["shop"], cat["products"]
    W, H, teal, ink = 1200, 630, (14, 124, 134), (16, 40, 43)
    img = Image.new("RGB", (W, H), (244, 247, 247))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 250], fill=teal)
    d.text((64, 54), _fit(d, st["name"], _font(64), W - 128), font=_font(64), fill="white")
    place = ", ".join(x for x in (st.get("barangay"), st.get("city")) if x)
    if place:
        d.text((64, 136), _fit(d, place, _font(34, False), W - 128), font=_font(34, False), fill=(214, 238, 240))
    ways = " · ".join(x for x in ("Pickup" if sh["pickup"] else "", f"Delivery ₱{sh['delivery_fee']:,.0f}" if sh["delivery"] else "") if x)
    d.text((64, 188), "Order online  ·  " + ways, font=_font(30), fill="white")
    y = 290
    for p in sorted(items, key=lambda x: -x["max_qty"])[:4]:
        d.rounded_rectangle([64, y, W - 64, y + 58], radius=14, fill="white")
        d.text((88, y + 12), _fit(d, p["name"], _font(30, False), W - 400), font=_font(30, False), fill=ink)
        price = f"₱{p['price']:,.2f}"
        d.text((W - 88 - d.textlength(price, font=_font(30)), y + 12), price, font=_font(30), fill=teal)
        y += 72
    if len(items) > 4:
        d.text((64, y + 2), f"+ {len(items) - 4} more items", font=_font(26, False), fill=(91, 113, 116))
    d.text((W - 64 - d.textlength("KWADERNO", font=_font(26)), H - 52), "KWADERNO", font=_font(26), fill=teal)
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()


def share_page(s: Session, slug: str, base: str, product_id: int | None = None) -> str:
    cat = svc.public_catalog(s, slug)
    st, sh, items = cat["store"], cat["shop"], cat["products"]
    page = f"{base}/s/{slug}" + (f"/p/{product_id}" if product_id else "")
    target = f"/shop/{slug}" + (f"?p={product_id}" if product_id else "")
    image = f"{base}/api/shop/{slug}/card.png"
    ways = " and ".join(x for x in ("pickup" if sh["pickup"] else "", "delivery" if sh["delivery"] else "") if x)
    title = f"{st['name']} — order online"
    desc = f"{len(items)} items in stock. Order for {ways}. " + (sh["note"] or "")
    p = next((x for x in items if x["id"] == product_id), None) if product_id else None
    if p is None and product_id:
        _, store = svc.open_shop(s, slug)
        prod = s.get(Product, product_id)  # sold out or hidden: still a friendly preview pointing to the store
        if prod is not None and prod.store_id == store.id:
            desc = f"{prod.name} is sold out right now — see what else {st['name']} has."
    if p:
        title = f"{p['name']} — ₱{p['price']:,.2f} at {st['name']}"
        desc = f"Order from {st['name']} for {ways}."
        prod = s.get(Product, p["id"])
        if prod and prod.thumbnail_url:
            image = base + auth.sign_media(prod.thumbnail_url, ttl=60 * 60 * 24 * 90)
    e = lambda x: html.escape(str(x), quote=True)  # noqa: E731
    return f"""<!doctype html><html lang="fil"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(title)}</title><meta name="description" content="{e(desc.strip())}">
<meta property="og:type" content="website"><meta property="og:site_name" content="KWADERNO">
<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc.strip())}">
<meta property="og:url" content="{e(page)}"><meta property="og:image" content="{e(image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="{e(st['name'])}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{e(title)}"><meta name="twitter:description" content="{e(desc.strip())}"><meta name="twitter:image" content="{e(image)}">
<link rel="canonical" href="{e(page)}"><meta http-equiv="refresh" content="0;url={e(target)}">
<style>body{{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#10282b}}a{{color:#0e7c86}}</style></head>
<body><p>Opening <a href="{e(target)}">{e(st['name'])}</a>…</p><script>location.replace({target!r})</script></body></html>"""

