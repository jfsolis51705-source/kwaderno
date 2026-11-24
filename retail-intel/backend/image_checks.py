"""Anti-fraud and quality checks for submitted photos (no ML needed).

- sha256: exact duplicate detection
- dHash (256-bit difference hash): near-duplicate detection (re-saved, resized or re-compressed copies)
- quality: file size, resolution and a blur score (variance of the Laplacian)
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass, field

from PIL import Image, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError

MIN_BYTES = 8 * 1024
MIN_SIDE = 320
BLUR_THRESHOLD = 60.0  # variance of the Laplacian below this is treated as blurry
NEAR_DUP_DISTANCE = 24  # max differing bits of the 256-bit dHash (re-saved copies differ by ~0-12; different receipts by 40+)


class InvalidImage(ValueError):
    pass


@dataclass
class ImageReport:
    sha256: str
    phash: str
    width: int
    height: int
    size_bytes: int
    blur_score: float
    issues: list[str] = field(default_factory=list)

    @property
    def quality_ok(self) -> bool:
        return not self.issues


def open_image(data: bytes) -> Image.Image:
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError) as e:
        raise InvalidImage("Not a readable image (use JPG, PNG or WebP)") from e
    return ImageOps.exif_transpose(img)


def dhash(img: Image.Image, size: int = 16) -> str:
    g = img.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    px = list(g.getdata())
    bits = 0
    for row in range(size):
        for col in range(size):
            left, right = px[row * (size + 1) + col], px[row * (size + 1) + col + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return f"{bits:0{size * size // 4}x}"


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def blur_score(img: Image.Image) -> float:
    g = img.convert("L")
    g.thumbnail((512, 512))
    lap = g.filter(ImageFilter.Kernel((3, 3), [0, 1, 0, 1, -4, 1, 0, 1, 0], scale=1, offset=128))
    return float(ImageStat.Stat(lap).var[0])


def analyze(data: bytes) -> ImageReport:
    img = open_image(data)
    w, h = img.size
    report = ImageReport(sha256=hashlib.sha256(data).hexdigest(), phash=dhash(img), width=w, height=h,
                         size_bytes=len(data), blur_score=round(blur_score(img), 2))
    if len(data) < MIN_BYTES:
        report.issues.append("file_too_small")
    if min(w, h) < MIN_SIDE:
        report.issues.append("low_resolution")
    if report.blur_score < BLUR_THRESHOLD:
        report.issues.append("blurry")
    return report
