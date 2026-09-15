#!/bin/bash
# Builds "Mission Control.app" — a native shell around the hosted web app.
#
#   ./mac/build.sh              → installs into /Applications
#   ./mac/build.sh ~/Applications  → installs somewhere else
#
# The app loads https://studioelastik.github.io/elastik-board/, so it picks up
# every `git push` on its own. Rebuild only when MissionControl.swift changes.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:-/Applications}"
APP="$DEST/Mission Control.app"
BUILD="$HERE/.build"

echo "Building Mission Control.app …"
rm -rf "$BUILD"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

# ── Compile ─────────────────────────────────────────────────────
swiftc -O \
  -target arm64-apple-macosx12.0 \
  -framework Cocoa -framework WebKit \
  -o "$BUILD/Contents/MacOS/MissionControl" \
  "$HERE/MissionControl.swift"

# ── Info.plist ──────────────────────────────────────────────────
cat > "$BUILD/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key>          <string>MissionControl</string>
  <key>CFBundleIconFile</key>            <string>AppIcon</string>
  <key>CFBundleIdentifier</key>          <string>us.studioelastik.missioncontrol</string>
  <key>CFBundleName</key>                <string>Mission Control</string>
  <key>CFBundleDisplayName</key>         <string>Mission Control</string>
  <key>CFBundlePackageType</key>         <string>APPL</string>
  <key>CFBundleShortVersionString</key>  <string>1.0</string>
  <key>CFBundleVersion</key>             <string>1</string>
  <key>LSMinimumSystemVersion</key>      <string>12.0</string>
  <key>NSHighResolutionCapable</key>     <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key> <true/>
</dict></plist>
PLIST

# ── Icon — the board mark: three coloured dots, three rows ───────
# Drawn from distance fields rather than filled pixel by pixel: every pixel
# takes the fraction of it a shape covers, so the plate's corners and the
# dots come out smooth at 16px and at 1024px alike. Each size is rendered
# natively rather than scaled from the big one.
python3 - "$BUILD/Contents/Resources" << 'PYEOF'
import struct, zlib, math, os, subprocess, sys

OUT = sys.argv[1]

def chunk(tag, data):
    c = tag + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def make_png(w, h, rows):
    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

# Layout in plate units (0–1 across the white plate). The mark sits well in
# from every edge: 22% to the left of the dots, 21.5% past the longest line,
# 28.5% above and below the rows.
DOT_L  = 0.220    # left edge of the dots
DOT_R  = 0.050    # dot radius
GAP    = 0.035    # dot edge → start of its line
LINE_R = 0.785    # right end of the longest line
LINE_H = 0.038    # line thickness
INK    = (17, 17, 17)
ROWS   = [(0.335, (255, 59, 48),  1.00),    # (centre y, dot colour, line length)
          (0.500, (0, 122, 255),  0.78),
          (0.665, (52, 199, 89),  0.91)]

def render(s):
    P    = s * 824 / 1024          # macOS icon grid: an 824 plate in a 1024 canvas
    o    = (s - P) / 2
    rad  = P * 0.2237              # plate corner radius
    mid  = s / 2
    flat = P / 2 - rad
    at   = lambda t: o + t * P     # plate units → pixels

    dot_cx, dot_r = at(DOT_L + DOT_R), DOT_R * P
    line_x0, cap  = at(DOT_L + 2 * DOT_R + GAP), LINE_H * P / 2
    line_x1       = at(LINE_R)
    shapes = []                    # (kind, geometry, colour, bounding box)
    for fy, col, frac in ROWS:
        cy = at(fy)
        shapes.append(('dot', (dot_cx, cy, dot_r), col,
                       (dot_cx - dot_r - 1, cy - dot_r - 1, dot_cx + dot_r + 1, cy + dot_r + 1)))
        a = line_x0 + cap                                   # capsule cap centres
        b = a + (line_x1 - line_x0 - 2 * cap) * frac
        shapes.append(('line', (a, b, cy, cap), INK, (a - cap - 1, cy - cap - 1, b + cap + 1, cy + cap + 1)))

    cover = lambda d: min(1.0, max(0.0, 0.5 - d))           # signed distance → pixel coverage
    rows = []
    for y in range(s):
        py = y + 0.5
        row = bytearray()
        for x in range(s):
            px = x + 0.5
            qx, qy = abs(px - mid) - flat, abs(py - mid) - flat
            alpha = cover(math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - rad)
            r = g = b = 255.0
            if alpha:
                for kind, geo, col, (bx0, by0, bx1, by1) in shapes:
                    if px < bx0 or px > bx1 or py < by0 or py > by1:
                        continue
                    if kind == 'dot':
                        cx, cy, rr = geo
                        k = cover(math.hypot(px - cx, py - cy) - rr)
                    else:
                        ca, cb, cy, rr = geo
                        k = cover(math.hypot(px - min(max(px, ca), cb), py - cy) - rr)
                    if k:
                        r += (col[0] - r) * k; g += (col[1] - g) * k; b += (col[2] - b) * k
            row += bytes((round(r), round(g), round(b), round(alpha * 255)))
        rows.append(row)
    return make_png(s, s, rows)

iconset = '/tmp/MissionControlAppIcon.iconset'
os.makedirs(iconset, exist_ok=True)
for sz in (16, 32, 128, 256, 512):
    open(f'{iconset}/icon_{sz}x{sz}.png', 'wb').write(render(sz))
    open(f'{iconset}/icon_{sz}x{sz}@2x.png', 'wb').write(render(sz * 2))

icns = os.path.join(OUT, 'AppIcon.icns')
r = subprocess.run(['iconutil', '-c', 'icns', '-o', icns, iconset],
                   capture_output=True, text=True)
print('  Icon OK' if r.returncode == 0 else f'  Icon warning: {r.stderr.strip()}')
PYEOF

# ── Sign + install ──────────────────────────────────────────────
# Ad-hoc signing is enough for a local app and keeps Gatekeeper quiet
# about a broken signature; it is not notarised, so the very first launch
# on a fresh machine still needs right-click → Open.
codesign --force --deep --sign - "$BUILD" 2>/dev/null || echo "  (codesign skipped)"

rm -rf "$APP"
mkdir -p "$DEST"
cp -R "$BUILD" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
rm -rf "$BUILD"

echo ""
echo "  ✓  $APP"
echo ""
echo "  ⌘R reloads · ⇧⌘R re-fetches from the server · ⌘0/⌘+/⌘- zoom"
echo ""
