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

# ── Icon — the same board mark the web app draws for its favicon ─
python3 - "$BUILD/Contents/Resources" << 'PYEOF'
import struct, zlib, os, subprocess, sys

OUT = sys.argv[1]

def chunk(tag, data):
    c = tag + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def make_png(w, h, px):
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in px)
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))

def render(size):
    s   = size
    img = [[(0, 0, 0, 0) for _ in range(s)] for _ in range(s)]

    # macOS icon grid: the art plate sits inset with a squircle-ish radius.
    inset = round(s * 0.094)
    plate = s - 2 * inset
    radius = plate * 0.225

    def in_plate(x, y):
        px, py = x - inset, y - inset
        if px < 0 or py < 0 or px >= plate or py >= plate:
            return False
        cx = min(max(px, radius), plate - radius)
        cy = min(max(py, radius), plate - radius)
        dx, dy = px - cx, py - cy
        return dx * dx + dy * dy <= radius * radius

    for y in range(s):
        for x in range(s):
            if in_plate(x, y):
                img[y][x] = (255, 255, 255, 255)

    def blend(x, y, col):
        if 0 <= x < s and 0 <= y < s and img[y][x][3]:
            img[y][x] = col

    def dot(cx, cy, r, col):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    blend(cx + dx, cy + dy, col)

    def bar(x0, x1, y, h, col):
        r = h // 2
        for x in range(x0 + r, x1 - r):
            for dy in range(-r, r + 1):
                blend(x, y + dy, col)
        dot(x0 + r, y, r, col)
        dot(x1 - r, y, r, col)

    f     = s / 256.0
    pad   = 0.13 * s
    dotR  = max(1, round(0.055 * s))
    lineH = max(2, round(0.038 * s))
    gap   = 0.030 * s
    dotX  = round(pad + dotR)
    lineX = round(dotX + dotR + gap)
    lmax  = (s - pad) - lineX

    rows = [(0.32, (255, 59, 48, 255),  0.92),
            (0.50, (0, 122, 255, 255),  0.72),
            (0.68, (52, 199, 89, 255),  0.84)]
    for fy, col, frac in rows:
        y = round(s * fy)
        dot(dotX, y, dotR, col)
        bar(lineX, round(lineX + lmax * frac), y, lineH, (17, 17, 17, 255))

    return make_png(s, s, img)

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
