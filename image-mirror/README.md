# Image Mirror

A Mac menu-bar app that mirrors an image to your iPhone over Wi-Fi. Drop or
paste an image on the Mac and it appears instantly, full-screen, on the phone —
no cloud, no account, no cable. The iPhone side is a PWA you add to your home
screen, so it opens like a native app.

Handy for design review, showing a reference on a second screen, checking how
artwork reads on a phone, and so on.

## How it works

```
  Mac menu-bar app                          iPhone PWA
  ┌──────────────────────┐                  ┌────────────────────┐
  │ drop / paste an image│                  │ full-screen viewer │
  │          │           │                  │         ▲          │
  │          ▼           │   HTTP (LAN)     │         │          │
  │  in-memory image  ───┼──── GET /current ┼─────────┘          │
  │          │           │                  │         ▲          │
  │          └─ version ─┼──── SSE /events ─┼─────────┘          │
  └──────────────────────┘                  └────────────────────┘
```

- The menu-bar app runs a tiny embedded HTTP server (`Network.framework`, no
  third-party dependencies).
- It holds the current image in memory and serves it at `GET /current`.
- Viewers subscribe to `GET /events`, a Server-Sent Events stream. When the
  image changes the app pushes a new version number and each viewer re-fetches
  `/current`. SSE is used instead of WebSockets because it needs no handshake
  or frame parsing — it is just a long-lived HTTP response.
- Pairing is a QR code shown in the menu-bar popover. Both devices must be on
  the same Wi-Fi network; nothing leaves the LAN.

## Requirements

- macOS 13 or later
- Xcode 15+ (or a Swift 5.9+ toolchain) to build the Mac app
- An iPhone on the **same Wi-Fi network**

## Run the Mac app

Open the package in Xcode and press Run:

```sh
open image-mirror/Package.swift
```

Or from the terminal:

```sh
cd image-mirror
swift run
```

The app has no Dock icon — look for the picture-in-picture icon in the menu
bar. The first time it starts, macOS asks for permission to find devices on the
local network; allow it, or the iPhone will not be able to connect.

> This is an unsigned local build. It does **not** need an Apple Developer
> account — it only runs on your own Mac.

## Connect the iPhone

1. Click the menu-bar icon to open the popover.
2. Scan the QR code with the iPhone's Camera app and open the link in Safari.
3. Tap **Share → Add to Home Screen**. Open it from the home screen for the
   full-screen, app-like experience.

If the QR/`.local` URL does not load, use the numeric `http://<ip>:<port>/`
address shown beneath it.

## Use it

- **Drag** an image file onto the drop zone in the popover, or
- copy an image anywhere and click **Paste image** (or press ⌘V with the
  popover focused).

The iPhone updates within a moment. **Clear** removes the image and the phone
returns to its placeholder. The PWA caches the last image, so it still shows
something if the Mac goes to sleep.

## Project layout

```
image-mirror/
├── Package.swift
├── tools/
│   └── make-icons.py              # regenerates the PWA icons (stdlib only)
└── Sources/ImageMirror/
    ├── ImageMirrorApp.swift       # @main, MenuBarExtra, hides the Dock icon
    ├── AppModel.swift             # shared state: current image + server
    ├── MenuContentView.swift      # the menu-bar popover UI
    ├── HTTPServer.swift           # embedded HTTP + SSE server
    ├── LANInfo.swift              # LAN IP, hostname, QR code
    └── Resources/web/             # the PWA, served to the iPhone
        ├── index.html
        ├── app.js
        ├── sw.js
        ├── manifest.json
        └── icon-192.png / icon-512.png
```

## Limitations / ideas

- One image at a time; no history.
- LAN only — by design.
- Could add: drag straight onto the menu-bar icon, multi-image gallery,
  pixel-peeping zoom controls, a "push from Finder" Quick Action.
