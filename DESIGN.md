---
name: Signal Scout
description: Obsidian. Cool neutral grounds, hairline borders and one obsidian slab for the brand and the primary action, in light and dark.
colors:
  canvas: { light: "#f7f7f9", dark: "#08080b" }
  surface: { light: "#ffffff", dark: "#111114" }
  subtle: { light: "#f1f1f4", dark: "#18181c" }
  line: { light: "#e5e5ea", dark: "#26262c" }
  line-soft: { light: "#efeff3", dark: "#1d1d22" }
  fg: { light: "#15141b", dark: "#ededf1" }
  fg-soft: { light: "#3c3b45", dark: "#c6c5ce" }
  fg-muted: { light: "#66656f", dark: "#908f9b" }
  obsidian: { light: "#15131d", dark: "#ecebf3" }
  primary: { light: "#15131d", dark: "#1b1926" }
  accent: { light: "oklch(0.52 0.2 285)", dark: "oklch(0.74 0.15 285)" }
  info: { light: "#2f55c8", dark: "#86a8ff" }
  danger: { light: "#c2372d", dark: "#ff8a80" }
  warn: { light: "#8f5600", dark: "#f1b85c" }
  ok: { light: "#1d7347", dark: "#5fd39a" }
gradients:
  obsidian: "radial-gradient(120% 90% at 50% 0%, oklch(0.36 0.1 285 / 0.6), transparent 62%), linear-gradient(180deg, oklch(0.2 0.02 280), oklch(0.13 0.014 272) 55%, oklch(0.08 0.006 265))"
typography:
  display: { fontFamily: "Geist Sans", fontSize: "40px", fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.035em" }
  page-title: { fontFamily: "Geist Sans", fontSize: "28px", fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.03em" }
  hook-claim: { fontFamily: "Geist Sans", fontSize: "22px", fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.02em" }
  section-title: { fontFamily: "Geist Sans", fontSize: "15px", fontWeight: 600, lineHeight: 1.4, letterSpacing: "-0.01em" }
  body: { fontFamily: "Geist Sans", fontSize: "14px", fontWeight: 400, lineHeight: 1.55 }
  draft-body: { fontFamily: "Geist Sans", fontSize: "15px", fontWeight: 400, lineHeight: 1.7 }
  label: { fontFamily: "Geist Sans", fontSize: "13px", fontWeight: 500, lineHeight: 1.4 }
  data: { fontFamily: "Geist Mono", fontSize: "12px", fontWeight: 400, lineHeight: 1.4 }
rounded:
  control: "8px"
  card: "12px"
  overlay: "16px"
  chip: "9999px"
motion:
  ease-out: "cubic-bezier(0.22, 1, 0.36, 1)"
  micro: "150ms"
  ui: "200-250ms"
  panel: "300ms"
  spring-indicator: "stiffness 500, damping 35"
  spring-overlay: "stiffness 300, damping 30"
  stagger: "50ms"
---

# Design System: Signal Scout

## Overview

**Obsidian.** Signal Scout is a working tool for a sales rep, so the interface stays quiet: cool near-neutral grounds, 1px hairline borders, generous spacing, and Geist type with tight headings. One material carries the brand: an **obsidian slab**, a near-black gradient with a faint violet sheen. It appears on the brand mark, the primary button, the selected hook's header, the "Writing as" card and empty-state tiles. The same slab is used in both themes, because it reads as premium on white and as a lifted surface on black.

Proof is still the product. Evidence quotes, dates, ids and scores are set in Geist Mono, and state colours only ever encode state.

References: Vercel Geist (gray roles, hairlines, tabular numbers), Linear (oklch tokens, accent kept out of the grays, keyboard first), Raycast (blue-tinted near-black, keycaps), Resend (glass header), Perplexity and ChatGPT Deep Research (source chips, Activity and Sources tabs), Lavender (draft beside its evidence), Lando Norris (one accent on near-black, masked headline reveal).

## Themes

- Light, dark, or follow the system. `next-themes` sets a `.dark` class on `<html>` before paint, so there is no flash. Transitions are disabled during a switch.
- Every colour is a semantic token in `src/app/globals.css` (`:root` and `.dark`), exposed to Tailwind v4 through `@theme inline`. Use `bg-surface`, `border-line`, `text-fg-muted` and so on. Never write raw hex or `bg-white` in a component.
- `obsidian` is a brand ink that adapts (dark text on light, light text on dark). `primary` and `.bg-obsidian-gradient` are the constant slab with white text.

## Colors

- **Grounds:** `canvas` (page, with a faint violet wash at the top), `surface` (cards), `subtle` (hover, recessed areas, tracks).
- **Lines:** `line` for card borders and dividers, `line-soft` inside cards.
- **Text:** `fg`, `fg-soft` for secondary prose, `fg-muted` for meta and hints. All meet AA on their grounds in both themes.
- **Accent:** violet, used only for focus rings, selection, the caret and the active pick in a list. It never fills a button.
- **State colours:** `info` = verified, `danger` = rejected or failed, `warn` = stale or needs attention, `ok` = done or sent. Each has a `-soft` ground. They never decorate.

## Typography

- Geist Sans for UI and prose; Geist Mono (`.acc`) only for data and verbatim quotes, never for decoration.
- Headings use weight 600 and negative tracking; labels use 500. Bold (700) is not used.
- Numbers in tables and stats use tabular figures.

## Layout

- **Top bar:** a sticky, blurred top bar holds the brand, the primary tabs, ⌘K search and the theme toggle. On small screens the tabs drop to a scrollable pill strip under the brand.
- **Content width:** max 1440px, 16px gutters on mobile, 32px from `sm`.
- **Page structure:** every page opens with `PageHeader` (one h1, one sentence, actions on the right).
- **Run view:** one grid with named areas. Narrow screens get outcome, draft, evidence, pipeline. `lg` puts the pipeline in a left column. `xl` adds a sticky draft column (`260px | 1fr | 440px`). The draft editor is mounted once.

## Elevation

Flat by default: cards are separated by hairlines, not shadows. Shadows appear only on things that float: dialogs, popovers, toasts, the command palette, the floating save bar, and a soft violet glow under the selected hook.

## Shapes

Controls 8px, cards 12px, overlays and the hook card 16px, badges and chips fully rounded.

## Components

All primitives live in `src/components/ui/` and `src/components/shell/`.

| Group | Component | What it is |
|---|---|---|
| Controls | `Button` / `buttonClass` | `primary` (obsidian slab with an inset highlight and a hover sheen; at most one per region), `secondary`, `ghost`, `danger`; `sm` 36px, `md` 44px; `loading` shows a spinner. |
| Controls | `Kbd` | Keycap for shortcuts. |
| Surfaces | `Card`, `PageHeader`, `EmptyState`, `Skeleton` | Containers, the page title block, empty states with an obsidian icon tile, and shimmering loading placeholders. |
| Overlays | `Dialog` / `useConfirm` | Accessible modal: focus trap, Escape, focus restored to the opener. Replaces `window.confirm`. Sending email always goes through it and shows the recipient, sender and subject. |
| Overlays | `Popover` | Outside click and Escape close it; `side` and `align` props. |
| Feedback | `Toast` / `useToast` | Bottom-right stack in an `aria-live` region. |
| Navigation | `Tabs`, `SegmentedControl` | The indicator slides with a shared `layoutId`. Tabs use arrow keys. |
| Data display | `Collapsible`, `NumberTicker`, `SpotlightCard`, `RelativeTime`, `Stagger`, `RiseIn` | Motion helpers. |
| Data display | `CopyButton` | Copies text; its icon morphs to a check and a toast confirms. |
| Shell | `TopNav` | The hover pill follows the pointer between tabs; the active underline springs to the current tab. |
| Shell | `CommandPalette` | ⌘K: pages, recent runs, theme. It only navigates; it never approves or sends. |
| Shell | `ThemeToggle` | System, Light or Dark. |

Run-view specifics:
- **Hook card:** obsidian header band and gradient hairline border (`.glow-border`), then the claim, the evidence quote and source chips.
- **Finding cards:** verdict chip, quote with a left rule and a copy button, a domain chip, and a freshness dot whose tooltip gives the full wording.
- **Draft panel:** a "Before you send" checklist (blockers first), a document-style editor, and a sticky action bar. The bar holds one primary action, Save edits only while dirty, and a menu for the rest. The reason a primary action is disabled is always written out.

## Motion

Motion comes from `motion/react` in client components only.
- **Accessibility:** `<MotionConfig reducedMotion="user">` wraps the app, and every CSS animation has a `prefers-reduced-motion` fallback.
- **Easing and durations:** ease-out `[0.22, 1, 0.36, 1]`. Micro interactions take 150ms, UI changes 200–250ms, panels 300ms. Never ease-in for UI.
- **Springs:** shared indicators (nav, tabs, palette selection) use `{ stiffness: 500, damping: 35 }`; overlays use `{ 300, 30 }`.
- **Enter:** pages rise 8px and fade in (`template.tsx`, enter only). Lists stagger by 50ms with a 4px blur-in. The run title reveals from a mask.
- **What animates:** only opacity, transform, filter, clip-path and layout. Never animate table refreshes, typing, or theme switches.

## Do's and Don'ts

### Do
- Use the semantic tokens and the primitives; add a new primitive before copying class strings.
- Keep one primary (obsidian) action per region.
- Write disabled reasons as text, not only as a `title`.
- Keep `role="status"` / `aria-live` regions for live progress.

### Don't
- Don't use `bg-white`, `text-white` (except on the obsidian slab), raw hex or `dark:` overrides for colours that have a token.
- Don't use state colours as decoration, or mono type for anything that isn't data or a quote.
- Don't add shadows to static cards, or gradients to tables, forms or body copy.
- Don't use native `window.confirm` / `alert`.
- Don't add motion to data refreshes, or exit animations on route changes.

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
