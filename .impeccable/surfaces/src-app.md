---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: ["src/components"]
---

# Surface brief: Signal Scout app (all routes)

Scope: the whole working app: runs dashboard (/), new run (/runs/new) with file drop, run view (/runs/[id]) with live pipeline, sender profile (/settings) with file drop. Visitor mode: **Operate**.

Audience and job: a B2B sales rep researching a prospect and reviewing a grounded draft; interviewers watching the run live. Task: start a run from any detail or file, watch it, judge the evidence, edit and approve the draft.

Constraints: standard web controls; WCAG AA; reduced motion; nothing is ever sent.

## Direction contract

THESIS: Every finding is a collected specimen carrying a collection label; nothing reaches the draft until a determination slip says verified. It refuses the category default of grey SaaS cards with one accent and a progress checklist.

OWN-WORLD: Deep botanical-green nav rail (#1f3b2d) over a sage mounting-board ground (#e8eee6); label-paper panels (#fbfbf7) with 1px sage rules; ink #1c2420; determination blue-black (#2c3e66) for verified slips, specimen red (#b3362b) for rejected, ochre (#b8862b) for stale or ambiguous. Atkinson Hyperlegible for UI and prose; Spline Sans Mono only for accession data (ids, dates, scores, domains). Raised from Crouwel: a strict column system (ledger, specimen, draft) with labels as ruled cells; the visible-grid overlay was dropped because the craft floor bans grid backgrounds on a ground that is not a measuring surface. Raised from Japanese high-density: dashboard rows carry status, hook, evidence counts, sources and active time. Raised from the boarding pass: a changed run or stage holds its state colour until seen.

STORY: The rep sees the prospect accessioned, watches each stage stamp its ledger line, reads the mounted hook with its label and slip, edits the draft, and approves it, trusting every fact because its quote and source sit beside it.

FIRST VIEWPORT: (run view) 76px green rail on the left with nav; header with the accession line (run id, time), prospect name and status pill. Below, three columns: the accession ledger (pipeline diagram) at 270px; the mounted hook specimen in the centre with its quote, a four-cell collection label and a pinned determination slip at the top right; the draft panel at 430px on the right with subject, editor and actions. The primary action, Approve draft, sits in the draft panel.

FORM: Herbarium Accession, position 6 of 7 on the grounded list (assigned by the roll); seed:f8152832acfd7ab1. Signature move: determination slips pinned to findings (det. verified / det. rejected / det. conflicting) and a live accession-ledger pipeline diagram whose lines stamp as each stage completes.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
