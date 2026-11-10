---
name: Signal Scout
description: Telemetry. A focused SaaS dashboard in a race-telemetry voice. Near-black (or white) grounds, Outfit with Martian Mono labels, one cyan-to-lime gradient, and inverted cards. Dark is the reference; light is its inversion.
colors:
  canvas: { light: "#f7f7f9", dark: "#09090a" }
  surface: { light: "#ffffff", dark: "#111113" }
  subtle: { light: "#f2f2f4", dark: "#18181b" }
  line: { light: "#e3e3e6", dark: "#232327" }
  fg: { light: "#0d0d0f", dark: "#f2f2ef" }
  fg-soft: { light: "#3a3a40", dark: "#d6d6da" }
  fg-muted: { light: "#66666d", dark: "#8d8d93" }
  info (verified): { light: "#007f9e", dark: "#00e0ff" }
  ok: { light: "#3f7a00", dark: "#c6ff3d" }
  warn: { light: "#9a5b00", dark: "#ffb547" }
  danger: { light: "#c2372d", dark: "#ff7a6b" }
  inverted card: { light: "#0d0d0f on light page", dark: "#f2f2ef on dark page" }
gradients:
  volt: { light: "linear-gradient(90deg, #0090b0, #3d5bff 45%, #4f8a00)", dark: "linear-gradient(90deg, #00e0ff, #5b8cff 45%, #c6ff3d)" }
typography:
  page-title: { fontFamily: "Outfit", fontSize: "26px", fontWeight: 600, letterSpacing: "-0.025em" }
  section-title: { fontFamily: "Outfit", fontSize: "15px", fontWeight: 600, letterSpacing: "-0.01em" }
  body: { fontFamily: "Outfit", fontSize: "14px", fontWeight: 400, lineHeight: 1.55 }
  stat: { fontFamily: "Outfit", fontSize: "28px", fontWeight: 500, letterSpacing: "-0.03em" }
  label: { fontFamily: "Martian Mono", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.12em" }
  data: { fontFamily: "Martian Mono", fontSize: "11.5px" }
rounded:
  card: "18-20px"
  control: "12px (fields)"
  pill: "9999px (buttons, tabs, nav, badges)"
motion:
  ease-out: "cubic-bezier(0.22, 1, 0.36, 1)"
  spring-indicator: "stiffness 500, damping 35"
  stagger: "50ms"
---

# Design System: Signal Scout

## Overview

**Telemetry.** Signal Scout reads like a focused SaaS dashboard with a race-telemetry voice. It was chosen in November 2026 from four direction mockups (Monolith, Aurora, Prism, Telemetry), with the navbar's pill box borrowed from Aurora.

The look comes from a few elements:
- **Type:** compact titles in Outfit, with uppercase Martian Mono labels for context lines, data and states.
- **Gradient:** one cyan-to-blue-to-lime gradient ("volt"), spread across segmented tracks and used as a 2–3px top edge on featured cards.
- **Inverted card:** a light card on dark pages (dark on light pages) for the thing to read or send.

There are no oversized headings and no decorative washes.

## Themes

Dark is the reference design; light is its inversion.
- **How it switches:** `next-themes` toggles `.dark` on `<html>` before paint, so there is no flash.
- **App tokens** (`--canvas`, `--surface`, `--line`, `--fg*`, state colours) and the Telemetry tokens (`--t-*`: volt, pill box, inverted card) both live in `src/app/globals.css`.
- **Inverted cards** (`.t-card-inv`) flip their state palette so tags stay readable in either theme.

## Colours

- **State colours encode meaning only:** cyan is verified or info, lime is ok or sent, amber is attention or stale, coral is rejected or failed. Neutral states use `fg-muted`.
- **The volt gradient** never fills large areas. It appears only on:
  - top edges of featured cards
  - track segments
  - the brand bar
  - one hero number per screen
  - the on state of a switch

## Typography

- **Outfit** for UI and prose. Titles are 26px semibold, section titles 15px semibold, body 14px.
- **Martian Mono** (`.acc`, `.t-mono`, `.t-label`) for labels, ids, dates, counts and evidence quotes. Labels are 11px, uppercase, with 0.12em tracking.

## Layout

- **Navbar:** centred and sticky (`TopNav`). It's one glass pill holding the brand and tabs, with a sliding active pill. ⌘K and the theme toggle sit on the right, and below the pill on tablets. On phones (under 640px) the top bar shrinks to one row (brand, theme, account, search) and every destination moves to a fixed bottom tab bar with icon and label; anything pinned to the bottom (the Start research bar, the draft action bar, save bars, toasts) sits above it, and `main` pads for it including the iPhone safe area.
- **Page header:** every page opens with `PageHeader`: a title, a mono context line (`label`), one optional sentence, and actions on the right.
- **Dashboards** (`/`): a row of compact stat cards, a slim funnel track, two-up cards, and charts.
- **Forms** (`/runs/new`): numbered sections (`TSection`) in one card, a pill mode switch, and a floating pill submit bar.
- **Run view:** pipeline column, outcome and hook, evidence tabs, and a sticky draft column. The draft editor is mounted once.

## Components

| Group | Component | What it is |
|---|---|---|
| Controls | `Button` / `buttonClass` | Pills. `primary` is the inverted pill (light on dark, dark with lime on light). `secondary` is outlined; also `ghost` and `danger`. |
| Controls | `T_PILL*` (`ui/telemetry.tsx`) | The same pills for raw markup. |
| Status | `Badge` | Dot and a mono uppercase word, on the state's soft ground. |
| Navigation | `Tabs`, `SegmentedControl` | The Aurora pill box, with the active pill sliding on a shared `layoutId`. |
| Forms | Fields (`Field.tsx`, `TField`/`TTextArea`) | Mono uppercase label, 12px-radius input, cyan focus ring. |
| Surfaces | `.t-card`, `.t-card-inv`, `.t-volt-bg`, `.t-seg`, `.t-rail` | Telemetry surfaces, gradient, segment slices and the horizontal rail. |
| Unchanged | `Dialog`/`useConfirm`, `Toast`, `Popover`, `CommandPalette`, `Collapsible`, `NumberTicker` | Still in use. Sending email always goes through the confirmation dialog. |
| Help | `Tooltip`, `InfoTip` (`ui/Tooltip.tsx`) | Hover and focus help, rendered in a portal and clamped to the viewport. Fields and `TSection` take a `tip`. |

## Motion

Motion is from `motion/react` and respects `MotionConfig reducedMotion="user"`.
- **Easing:** ease-out `[0.22, 1, 0.36, 1]`. Indicators use a spring (500/35).
- **What moves:** pages rise in, lists stagger, and numbers tick up. Track segments and bars grow from zero once. The run title reveals from a mask.
- **What doesn't:** data refreshes and typing are never animated.

## Do's and Don'ts

### Do
- Use the tokens and primitives.
- Keep one primary (inverted) pill per region.
- Put context in mono labels.
- Keep copy lean: pages show titles, mono labels and data. Explanations go in a `Tooltip` or `InfoTip` (portalled, so nothing clips them), and a disabled button gives its reason in its tooltip.
- Keep guardrail wording visible: "our inference, not a fact" and stale or bad-news warnings are never moved into tooltips.

### Don't
- Don't use oversized display type, gradient washes, raw hex in components, or state colours as decoration.
- Don't use `window.confirm`.

## UI and UX review (November 2026)

The redesign came from a senior-PM review that listed 25 UI and 25 UX improvements. All of them are implemented.

**UI**
1. Top tab navigation, sticky and blurred.
2. Breadcrumbs on the run page.
3. Obsidian primary button with a sheen.
4. One `Button` primitive.
5. Semantic tokens with no hardcoded white.
6. Geist with tight headings.
7. Hairline cards.
8. Stat tiles with a number ticker and spotlight.
9. Hook card with a gradient border.
10. Finding cards with domain chips.
11. Compact freshness dot.
12. Softer pipeline stepper.
13. Dot-and-label status badges.
14. Runs as a link grid with relative times.
15. Stacked rows on mobile.
16. New-run hero heading and pitch picker in a popover.
17. "Before you send" checklist.
18. Document-style draft editor.
19. Evidence tabs.
20. Empty states.
21. Skeletons.
22. Extended icon set.
23. Settings sections and a floating save bar.
24. Toasts.
25. One accent focus ring.

**UX**
1. ⌘K command palette.
2. Draft shortcuts (E, ⌘S, ⌘↵, which still confirms before sending).
3. Styled confirmation dialogs.
4. Loading, error and not-found routes.
5. Page enter motion.
6. Current state first on mobile, with a progress pill.
7. Staggered findings.
8. Live narration in a status region.
9. A single draft editor mount.
10. Unsaved-edit guards.
11. Blockers ordered first, with the fix inline.
12. Sticky action bar with an overflow menu.
13. A diff of what an AI rewrite changed.
14. Collapsible audit and version timeline.
15. One-prospect and Import-a-list tabs with a sticky submit.
16. Accessible pitch popover.
17. Keyboard-reachable runs rows (↑/↓, `/` to search).
18. Saved views kept in the URL.
19. Ticking relative times.
20. "Needs your action" first, system status collapsed.
21. Floating save bar with ⌘S.
22. Contacts as editable lists with a match/note preview and text mode.
23. Copy buttons for the email and quotes.
24. Theme toggle in the bar and the palette, with no flash.
25. Reduced motion, 44px targets and focus restore.
