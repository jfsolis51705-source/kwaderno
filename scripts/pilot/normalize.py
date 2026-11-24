"""
Normalise the pilot merchant map (KML) + field-survey workbook (XLSX) into one JSON list.

    python3 -I scripts/pilot/normalize.py data/private/pilot-map.kml data/private/pilot-leads.xlsx data/private/pilot-merchants.json

Privacy rules (agreed with the product owner):
- KEEP: store name, address, barangay, city, coordinates, business type, surveyor/area,
  signed/registered/retention status, survey date, owner name, contact mobile number.
- DROP: GCash numbers, crypto wallets/networks/QR links, payout amounts/dates/references,
  photo links, free-text remarks.
Inputs and output live in data/private/ which is git-ignored. This script contains no data.
"""
import hashlib, json, math, re, sys, unicodedata
import xml.etree.ElementTree as ET
from datetime import date, datetime

import openpyxl

NS = {"k": "http://www.opengis.net/kml/2.2"}
PHONE = re.compile(r"(?:\+?63|0)9\d{9}")


def norm_name(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"signed merchant|sari[\s-]*sari|store|mart|/.*$", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def norm_phone(s):
    m = PHONE.search(re.sub(r"[\s-]", "", str(s or "")))
    if not m:
        return None
    p = m.group(0)
    return "0" + p[-10:]


def latlon(s):
    nums = re.findall(r"-?\d+\.\d+", str(s or ""))
    if len(nums) >= 2:
        a, b = float(nums[0]), float(nums[1])
        if 4 < a < 22 and 116 < b < 127:
            return a, b
    return None


def meters(a, b):
    dlat = math.radians(b[0] - a[0]); dlon = math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def guess_city(address, layer):
    a = (address or "").lower()
    for key, city in [("quezon", "Quezon City"), ("caloocan", "Caloocan City"), ("pasig", "Pasig City"), ("malabon", "Malabon City"),
                      ("valenzuela", "Valenzuela City"), ("manila", "Manila"), ("balanga", "Balanga City"), ("bulacan", "Bulacan")]:
        if key in a:
            return city
    if "BALANGA" in layer.upper():
        return "Balanga City"
    return None


def to_date(v):
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    m = re.match(r"(\d{4})/(\d{2})/(\d{2})", str(v or ""))
    return f"{m[1]}-{m[2]}-{m[3]}" if m else None


def read_kml(path):
    doc = ET.parse(path).getroot().find("k:Document", NS)
    out = []
    for folder in doc.findall("k:Folder", NS):
        layer = (folder.findtext("k:name", namespaces=NS) or "").strip()
        for p in folder.findall("k:Placemark", NS):
            raw = (p.findtext("k:name", namespaces=NS) or "").strip()
            coords = (p.findtext(".//k:coordinates", namespaces=NS) or "").strip()
            if not coords:
                continue
            lon, lat = map(float, coords.split(",")[:2])
            desc = re.sub(r"<[^>]+>", " / ", p.findtext("k:description", namespaces=NS) or "")
            parts = [x.strip(' "') for x in desc.split("/") if x.strip(' "')]
            address = parts[0] if parts else None
            owner = next((x for x in parts[1:] if not PHONE.search(re.sub(r"[\s-]", "", x)) and re.search(r"[A-Za-z]{3}", x)), None)
            out.append({
                "layer": layer,
                "storeName": re.sub(r"\s*signed merchant\s*", " ", raw, flags=re.I).strip(),
                "signed": bool(re.search(r"signed merchant", raw, re.I)),
                "address": address,
                "ownerName": owner,
                "contactPhone": norm_phone(desc),
                "latitude": round(lat, 7),
                "longitude": round(lon, 7),
            })
    return out


def header_index(row, *needles):
    for i, c in enumerate(row):
        h = str(c or "").strip().lower()
        if all(n in h for n in needles):
            return i
    return None


def read_survey_rows(wb):
    """Yield dicts from the survey tabs, keeping only allowed fields."""
    rows = []
    # Master survey tab
    ws = wb["100 Store "]
    it = ws.iter_rows(values_only=True)
    hdr = next(it)
    ix = {
        "date": header_index(hdr, "submitted"), "surveyor": header_index(hdr, "surveyor"), "parent": header_index(hdr, "parent"),
        "outlet": header_index(hdr, "outlet", "name"), "address": header_index(hdr, "address"), "mobile": header_index(hdr, "mobile"),
        "retain": header_index(hdr, "retain"), "category": header_index(hdr, "category"),
    }
    loc_i = next((i for i, c in enumerate(hdr) if "outlet" in str(c or "").lower() and ("location" in str(c).lower() or "lat" in str(c).lower() or "gps" in str(c).lower())), None)
    for r in it:
        if not any(r):
            continue
        g = lambda k: r[ix[k]] if ix[k] is not None and ix[k] < len(r) else None
        ll = latlon(r[loc_i]) if loc_i is not None else next((latlon(c) for c in r if latlon(c)), None)
        rows.append({"name": g("outlet") or g("parent"), "address": g("address"), "latlon": ll, "surveyedOn": to_date(g("date")),
                     "surveyor": g("surveyor"), "contactPhone": norm_phone(g("mobile")), "retention": (str(g("retain") or "").strip().lower() or None),
                     "businessType": g("category")})
    # Kiko Solis tracker: barangay, registered, owner, contact, retain
    ws = wb["KIKO SOLIS LANSCAPE"]
    it = ws.iter_rows(values_only=True)
    hdr = next(it)
    ix = {"date": header_index(hdr, "date"), "brgy": header_index(hdr, "barangay"), "name": header_index(hdr, "store name"),
          "address": header_index(hdr, "address"), "ll": header_index(hdr, "long lat"), "reg": header_index(hdr, "registered"),
          "owner": header_index(hdr, "owner"), "contact": header_index(hdr, "contact"), "type": header_index(hdr, "type"), "retain": header_index(hdr, "retain")}
    for r in it:
        if not any(r) or not r[ix["name"]]:
            continue
        g = lambda k: r[ix[k]] if ix[k] is not None and ix[k] < len(r) else None
        rows.append({"name": g("name"), "address": g("address"), "latlon": latlon(g("ll")), "surveyedOn": to_date(g("date")), "barangay": g("brgy"),
                     "registration": g("reg"), "ownerName": g("owner"), "contactPhone": norm_phone(g("contact")),
                     "businessType": g("type"), "retention": (str(g("retain") or "").strip().lower() or None)})
    return rows


def main(kml_path, xlsx_path, out_path):
    pins = read_kml(kml_path)
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    survey = read_survey_rows(wb)
    matched = 0
    for p in pins:
        here = (p["latitude"], p["longitude"])
        key = norm_name(p["storeName"])
        cands = [s for s in survey if (s["latlon"] and meters(here, s["latlon"]) < 60) or (key and norm_name(s["name"]) == key)]
        if cands:
            matched += 1
        for s in cands:
            for field in ("ownerName", "contactPhone", "surveyedOn", "barangay", "registration", "retention", "businessType", "surveyor"):
                if s.get(field) and not p.get(field):
                    p[field] = str(s[field]).strip() if not isinstance(s[field], str) else s[field].strip()
        p["city"] = guess_city(p.get("address"), p["layer"])
        r = (p.get("retention") or "").lower()
        p["retention"] = "retain" if "retain" in r else ("stopped" if "stop" in r else None)  # anything else is a mis-keyed cell
        bt = (p.get("businessType") or "").lower()
        p["businessType"] = "convenience_store" if "conv" in bt else ("mini_mart" if "mart" in bt else "sari_sari")
        p["externalKey"] = hashlib.sha1(f'{p["layer"]}|{norm_name(p["storeName"])}|{p["latitude"]:.5f}|{p["longitude"]:.5f}'.encode()).hexdigest()[:20]
    # The map contains a few pins dropped twice on the same spot; keep the first.
    seen, unique = set(), []
    for p in pins:
        if p["externalKey"] not in seen:
            seen.add(p["externalKey"])
            unique.append(p)
    if len(unique) != len(pins):
        print(f"removed {len(pins) - len(unique)} duplicate pin(s)")
    pins = unique
    with open(out_path, "w") as f:
        json.dump(pins, f, ensure_ascii=False, indent=1)
    print(f"{len(pins)} pins written to {out_path}; {matched} enriched from survey tabs")
    by = {}
    for p in pins:
        by[p["layer"]] = by.get(p["layer"], 0) + 1
    print("by layer:", by)
    print("with owner:", sum(1 for p in pins if p.get("ownerName")), "with contact:", sum(1 for p in pins if p.get("contactPhone")),
          "signed:", sum(p["signed"] for p in pins), "retain:", sum(1 for p in pins if p.get("retention") == "retain"),
          "barangay:", sum(1 for p in pins if p.get("barangay")), "city:", sum(1 for p in pins if p.get("city")))


if __name__ == "__main__":
    main(*sys.argv[1:4])
