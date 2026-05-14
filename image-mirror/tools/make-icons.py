#!/usr/bin/env python3
"""Generate the PWA icons (icon-192.png, icon-512.png) with no third-party deps.

Renders a sharp master bitmap, then box-downsamples it to each target size so
the downscaling itself does the anti-aliasing. Run from anywhere:

    python3 tools/make-icons.py
"""

import struct
import zlib
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent.parent / "Sources/ImageMirror/Resources/web"
MASTER = 1536  # divisible by both 512 and 192
SIZES = [512, 192]

# Palette
BG_TOP = (99, 102, 241)     # indigo-500
BG_BOTTOM = (67, 56, 202)   # indigo-700
CARD = (255, 255, 255)
MARK = (79, 70, 229)        # indigo-600


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_rect_contains(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def circle_contains(x, y, cx, cy, r):
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def _edge(px, py, ax, ay, bx, by):
    return (px - bx) * (ay - by) - (ax - bx) * (py - by)


def triangle_contains(px, py, a, b, c):
    d1 = _edge(px, py, a[0], a[1], b[0], b[1])
    d2 = _edge(px, py, b[0], b[1], c[0], c[1])
    d3 = _edge(px, py, c[0], c[1], a[0], a[1])
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def color_at(u, v):
    """Color for normalized coordinates u, v in [0, 1]."""
    color = lerp(BG_TOP, BG_BOTTOM, (u + v) / 2)
    if rounded_rect_contains(u, v, 0.19, 0.19, 0.81, 0.81, 0.10):
        color = CARD
        if circle_contains(u, v, 0.37, 0.35, 0.07):
            color = MARK
        if triangle_contains(u, v, (0.26, 0.72), (0.50, 0.40), (0.74, 0.72)):
            color = MARK
    return color


def render_master():
    rows = []
    for py in range(MASTER):
        v = (py + 0.5) / MASTER
        row = []
        for px in range(MASTER):
            u = (px + 0.5) / MASTER
            row.append(color_at(u, v))
        rows.append(row)
    return rows


def downsample(master, size):
    factor = MASTER // size
    area = factor * factor
    out = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for dy in range(factor):
                src_row = master[y * factor + dy]
                for dx in range(factor):
                    pr, pg, pb = src_row[x * factor + dx]
                    r += pr
                    g += pg
                    b += pb
            row += bytes((r // area, g // area, b // area, 255))
        out.append(bytes(row))
    return out


def write_png(path, rows, size):
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type: none
        raw += row
    compressed = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main():
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    master = render_master()
    for size in SIZES:
        rows = downsample(master, size)
        path = WEB_DIR / f"icon-{size}.png"
        write_png(path, rows, size)
        print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    main()
