---
version: 2
slug: "src-app"
primary_target: "src/app"
related_targets: ["src/components"]
---

# Surface brief: Signal Scout app (all routes)

**Scope:** the whole working app.
- Outreach dashboard (/)
- Runs list (/runs)
- New run (/runs/new), with file drop and list import
- Run view (/runs/[id]), with the live pipeline and draft review
- Sender profile (/settings)
- Contacts (/contacts)

Visitor mode: **Operate**.

**Audience and job:** a B2B sales rep researching a prospect and reviewing a grounded draft, plus interviewers watching a run live. The rep starts a run from any detail or file, watches it, judges the evidence, edits and approves the draft, and sends it from their own Gmail after a confirmation.

**Constraints:**
- Standard web controls.
- WCAG AA in both themes.
- Reduced motion respected.
- Nothing is sent without the rep's confirmed approval.

## Direction contract

**THESIS:** A calm, modern tool where proof sits beside every claim. One obsidian material carries the brand and the single primary action. Everything else is neutral, so the evidence and its state colours do the talking.

**OWN-WORLD:**
- Cool near-neutral grounds: light `#f7f7f9`, dark `#08080b`.
- Hairline borders.
- An obsidian slab gradient with a faint violet sheen, used for the brand mark, the primary button, the hook header and empty-state tiles.
- Geist Sans for UI and Geist Mono for data and quotes.
- State colours (info, danger, warn, ok) reserved for meaning.
- Light, dark and system themes.

**STORY:** The rep names a prospect and watches the pipeline fill in live. They read the selected hook in an obsidian-headed card with its quote and source, scan the findings by tab, resolve the "Before you send" checklist, edit the draft like a document, and approve or send it, confirming the exact recipient in a dialog.

**FIRST VIEWPORT (run view):**
- Sticky top tabs.
- Breadcrumb, then the prospect name revealed from a mask, then the status badge.
- Three columns at `xl`: the pipeline stepper (260px), the outcome and hook card in the centre with the evidence tabs below them, and the sticky draft panel (440px) with its action bar.

**FORM:** Obsidian. Signature moves:
- The obsidian slab, used sparingly.
- Shared-layout indicators that slide (nav, tabs, palette, theme toggle).
- The "Before you send" checklist that orders blockers first.

**FINISH:** Documented in DESIGN.md. Verified in light and dark at desktop and mobile widths. typecheck, lint, test and build all pass.
