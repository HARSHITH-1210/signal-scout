---
name: Signal Scout
description: Herbarium Accession. Every finding is a collected specimen with its collection label and determination slip.
colors:
  rail: "#1f3b2d"
  rail-strong: "#16291f"
  rail-ink: "#dfe8dc"
  rail-muted: "#9fb5a5"
  board: "#e8eee6"
  board-deep: "#dde5da"
  paper: "#fbfbf7"
  ink: "#1c2420"
  ink-soft: "#46544b"
  muted: "#56645b"
  rule: "#cfd9cc"
  rule-soft: "#e1e8de"
  quote: "#eef2ea"
  det: "#2c3e66"
  det-soft: "#e4e9f3"
  specimen: "#b3362b"
  specimen-soft: "#f7e6e3"
  ochre: "#7d5410"
  ochre-soft: "#f5ecd8"
  ok: "#2e6b43"
  ok-soft: "#e3efe5"
typography:
  page-title:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  section-title:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.4
  hook-claim:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  draft-body:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
  accession:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  index-title:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  outcome-title:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.35
  subtitle:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  secondary:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  rail-label:
    fontFamily: "Atkinson Hyperlegible, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  chip: "4px"
  control: "8px"
  panel: "12px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.rail}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.rail-strong}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.rail}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "44px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.panel}"
    padding: "20px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  badge-verified:
    backgroundColor: "{colors.det-soft}"
    textColor: "{colors.det}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  nav-rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-muted}"
    width: "84px"
---

# Design System: Signal Scout

## Overview

**Herbarium Accession.** Signal Scout is a working research tool whose promise is that every fact in a draft traces back to a quote. The visual world borrows from herbarium specimen sheets: a botanical-green nav rail, a sage mounting-board ground, and label-paper panels. Each finding is "mounted" with a typed collection label (source, date, accession id, reliability) and a pinned **determination slip** that states the verdict: verified, rejected or conflicting.

It's an Operate surface, so the world contributes only type, palette, density and that one signature move. Navigation, forms, tables and buttons stay standard web controls. The live **accession ledger** (the pipeline diagram) is the second signature: the run's eight stages on a vertical line that fills in as each completes, with the two exits (needs clarification, not enough signal) as side tabs that light up only when taken.

**Key characteristics**
- Proof sits beside every claim: the verbatim quote, in mono on a quote-tinted field, directly under the claim it backs.
- Stopping is a first-class outcome: amber and red outcome panels get the same weight as success.
- One rhythm of label-paper panels on sage; borders, not shadows (the slip is the only lifted element).

## Colors

### Primary
- **Rail green** (`#1f3b2d`): the nav rail, primary buttons, filled ledger spine. Hover deepens to `#16291f`.

### Secondary
- **Determination blue-black** (`#2c3e66`): verified slips, links, focus rings, the running stage. Tint `#e4e9f3`.

### Tertiary
- **Specimen red** (`#b3362b`): rejected findings, failures, destructive hover. Tint `#f7e6e3`.
- **Ochre** (`#7d5410`): stale or attention states, clarification and not-enough-signal outcomes, warnings. Tint `#f5ecd8`. Darkened from `#b8862b` so text passes AA.
- **Check green** (`#2e6b43`): completed stages, success copy. Tint `#e3efe5`.

### Neutral
- **Board** `#e8eee6` (page ground), **board-deep** `#dde5da` (neutral badges, status line), **paper** `#fbfbf7` (panels), **quote** `#eef2ea` (verbatim evidence field).
- Text: **ink** `#1c2420`, **ink-soft** `#46544b`, **muted** `#56645b` (≥4.8:1 on every ground).
- Rules: `#cfd9cc` panel borders, `#e1e8de` row dividers.

### Named Rules
- **The determination rule.** Blue-black means verified, red means rejected or failed, ochre means stale or needs attention. These colours never decorate.
- **One accent per screen region.** The rail green carries actions; colour elsewhere always encodes state.

## Typography

Atkinson Hyperlegible carries all UI and prose. It's a workhorse face built for legibility, which suits a tool read under demo pressure. Spline Sans Mono is used **only** for accession data: ids, dates, scores, domains, word counts and verbatim quotes, all with tabular figures.

### Hierarchy
A ten-step ramp: 11 / 12 / 13 / 14 / 15 / 16 / 17 / 22 / 28 / 32 px. No half-pixel sizes.
- Run title 32px/700 and index-page titles 28px/700, tracking -0.01em, balanced.
- Hook claim 22px/700, at most 38ch. Outcome titles 17px/700.
- Section title 15px/700. Body 15px/400, 1.5. Draft body and subtitles 16px, 1.65 for the draft.
- Small UI 14px, secondary text 13px, rail labels 11px.
- Accession data 11–13px mono.

### Named Rules
- **Mono is evidence.** A string in mono is either data or a verbatim quote. Never use it as decoration.

## Layout

- A shell with an 84px rail on desktop, collapsing to a sticky top bar under `lg`. Content max width 1440px, gutters 16px (mobile) and 32px (desktop).
- Run view: `290px | 1fr | 420px` at `xl` (ledger, specimen, draft), dropping to `290px | 1fr` at `lg` with the draft after the outcome, and to one column on mobile.
- Dashboard: a single dense table (status, live stage, hook, verified / sources, active time, started). It scrolls horizontally inside its panel on narrow screens.
- Panels are spaced 24px apart, with 20px padding.

## Elevation & Depth

Flat by default: 1px rule borders define panels. The one exception is the **determination slip**, a pinned label with a soft offset shadow (`0 6px 14px -6px rgb(31 59 45 / 0.28)`) and a 2° tilt on the hook.

## Shapes

Panels 12px, controls and focus rings 8px, slips and chips 2–4px, badges and filter chips fully rounded. No other radii.

## Components

### Buttons
Primary is rail green with white text and a 44px minimum height. Secondary is a rail-green outline. Tertiary is a text button in blue-black. Disabled is 45% opacity with a not-allowed cursor.

### Chips
Status badges are pill-shaped tints with bold 12px text. A live dot pulses while a run is active. Filter chips use `aria-pressed`, and the selected one fills with rail green.

### Cards / Containers
The label-paper panel is the only container. Outcome panels (in progress, clarification, not enough signal, failed) use the same panel with a state-tinted border and title.

### Inputs / Fields
A visible label above every control, a paper background, a rule border, and a blue-black focus ring at 30%. Errors in specimen red sit under the field and are linked with `aria-describedby`. The drop zone is a labelled file input (click, keyboard, or drag) with a 44px "Choose file" control.

### Navigation
The rail holds an icon and label per item. The active item is a darker green tile with white text. On small screens it becomes a horizontal bar.

### Determination slip (signature)
A small pinned label in mono: an uppercase verdict ("det. verified") over a one-line basis ("quote matched in S5 + 1 more"). It's pinned to the top edge of every finding card and tilted 2° on the hook.

### Accession ledger (signature)
The pipeline as a vertical spine with 22px stage nodes. A node's state sets its fill and glyph (number, check, alert, cross, dash). The running stage carries a pulse ring, and the next spine segment flows. A single `role="status"` line announces "Stage n of 8: …". Exit tabs appear only when an exit is taken (or in preview).

## Do's and Don'ts

### Do:
- Put the verbatim quote directly under every claim, in mono on the quote field.
- Label inference as inference ("Why it matters, our inference, not a fact").
- Use the state colours only to encode state.
- Keep every control standard and keyboard-reachable, with a 44px target for primary actions.

### Don't:
- Don't add eyebrows or kickers above headings. Metadata goes under the title.
- Don't use glyph characters as icons. The authored 16px SVG set (1.6 stroke) is the icon family.
- Don't add shadows to panels. Only the determination slip lifts.
- Don't draw grid or stripe textures on the board ground; it's a mounting board, not a measuring surface.
