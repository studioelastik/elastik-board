---
name: ux-ui-pro-max
description: >-
  Pro-level UX/UI design pass for the Mission Control kanban PWA
  (elastik-board.html). Use when the user asks to design, restyle, polish,
  audit, or improve the look, feel, layout, spacing, color, typography,
  motion, accessibility, responsive behavior, or overall "UX/UI" of the app —
  e.g. "make the cards look nicer", "tighten the spacing", "this feels off on
  mobile", "do a design review", "improve the dark theme". Encodes the app's
  existing design tokens and conventions so changes stay consistent.
---

# UX/UI Pro Max

A design-quality workflow for **Mission Control** — a single-file kanban PWA
(`elastik-board.html`) with an Apple-flavored, token-driven design system.
The goal of every pass is changes that look *intentional and native to the
existing system*, never bolted on.

## First principle: respect the system that exists

This app already has a coherent design language. Before changing anything,
read the relevant CSS and reuse what's there. **Never hardcode a value a token
already covers.** New magic numbers, off-palette colors, and one-off radii are
the most common way to make this app look worse.

### Design tokens (defined in `:root`, overridden under `[data-theme="dark"]`)

| Concern | Tokens |
|---|---|
| Radius | `--r: 6px`, `--r-lg: 10px` |
| Layout | `--sidebar: 220px`, `--header-h: 52px` |
| Surfaces | `--bg`, `--surface`, `--surface2` |
| Borders | `--border`, `--border-strong` |
| Text hierarchy | `--text` → `--text-2` → `--text-3` (primary → secondary → tertiary) |
| Accent | `--accent`, `--accent-bg` |
| Shadows | `--shadow-card`, `--shadow-card-hover` |
| Status (bg/text/border triplets) | `done`, `wip`, `next`, `block`, `nosched`, `archive` (e.g. `--s-done-bg`) |
| Column accents | `--col-wip`, `--col-next`, `--col-done`, `--col-block`, `--col-nosched`, `--col-archive` |

- **Type:** `DM Sans` for UI, `DM Mono` for monospace/numeric.
- **Color:** stay on the existing palette. New states reuse the status triplet
  pattern. Don't introduce a new hue without a real semantic reason.
- **Depth:** elevation comes from `--shadow-card` / `--shadow-card-hover`. Dark
  theme deliberately uses flat surfaces + a hairline ring instead of drop
  shadows — preserve that.

## Non-negotiable constraints

1. **Light + dark parity.** Every visual change must hold up in both themes.
   If you touch a color, verify (or set) its `[data-theme="dark"]` counterpart.
   Check contrast in both — dark text on dark status backgrounds is the usual
   failure.
2. **Single file.** All CSS/HTML/JS lives in `elastik-board.html`. Add styles
   near related rules, match the surrounding formatting, and don't restructure
   the file to suit a change.
3. **Mobile + PWA is a first-class target.** This installs as a standalone
   app. Honor `env(safe-area-inset-*)` (already used for top/bottom padding),
   respect the established breakpoints (`768px`, `700px`, `900px`, `992px`,
   and `@media (pointer: coarse)` for touch), and keep touch targets ≥ 44px.
4. **Don't break drag-and-drop.** The kanban relies on native drag/drop and
   careful scroll/layout preservation. Visual tweaks to cards/columns must not
   change drag affordances, hit areas, or layout-on-drop behavior.

## Workflow

1. **Locate.** Grep `elastik-board.html` for the component (e.g. `.task-card`,
   `#sidebar`, `.col-`, status class) and read its full rule block plus the
   tokens it consumes before editing.
2. **Diagnose, don't redecorate.** Name the specific UX problem — rhythm,
   hierarchy, contrast, alignment, density, affordance, feedback — and fix
   *that*. Avoid sweeping restyles when a targeted fix is what's needed.
3. **Edit with tokens.** Make the smallest change that resolves the issue,
   expressed in existing tokens and spacing scale. Add a new token only when a
   value is genuinely reused and semantic.
4. **Verify both themes + mobile.** Walk light/dark and narrow widths mentally
   (or with the `run`/`verify` skill). Confirm contrast, alignment, and that
   nothing in adjacent components shifted.

## Pro-max checklist

Apply these as a quality bar, not a to-do list — flag what's worth fixing.

- **Visual hierarchy** — does the eye land on what matters first? Use the
  `--text`/`--text-2`/`--text-3` ladder and weight, not just size.
- **Spacing rhythm** — consistent, related spacing values; align to existing
  paddings/gaps rather than inventing new ones.
- **Alignment & grid** — edges and baselines line up; optical centering where
  geometric centering looks off (icons, the position number on cards).
- **Contrast (WCAG AA)** — body text ≥ 4.5:1, large/UI ≥ 3:1, in *both* themes.
- **State feedback** — hover, active, focus, drag, loading, empty, and error
  states all exist and feel responsive. Empty states should guide, not blank.
- **Motion** — transitions are quick (~.15–.2s) and purposeful. **Gap to
  watch:** there is currently no `prefers-reduced-motion` handling — add it
  when introducing or expanding animation.
- **Accessibility** — visible focus rings (don't strip `outline` without a
  replacement), keyboard reachability, real labels. ARIA coverage is currently
  thin (~a handful of attributes); improving it is fair game in a UX pass.
- **Touch ergonomics** — ≥44px targets, comfortable thumb reach, no hover-only
  affordances on `pointer: coarse`.
- **Polish** — pixel-rounding, crisp 1px borders via `--border`, consistent
  corner radii, no clipped shadows or text.

## What "pro max" means here

Restraint over flash. The best change is often *less*: removing a redundant
border, aligning two elements, calming a shadow, tightening a gap. Match
Apple-grade attention to spacing and hierarchy. When proposing something bold,
show it's deliberate and reversible, and explain the UX rationale — not just
"looks nicer."
