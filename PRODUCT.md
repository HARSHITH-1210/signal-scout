# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
- **Primary: a B2B sales rep (SDR or AE)** preparing first-touch outreach. They name a prospect, or drop in a document or CSV, and need a draft worth sending without spending 20 minutes on research. They review, edit and approve every draft themselves.
- **Secondary: case-study interviewers** watching a live demo. They need to see each stage of the process run and understand its decisions, including the edge cases, within minutes.

## Product Purpose
Signal Scout turns a prospect (any one detail: a name, company, website, LinkedIn URL, role, note, PDF or CSV row) into a personalised outreach draft grounded in real, public information. Success means a draft a rep would actually send, a hook that is specific to this prospect, and zero invented facts. When the evidence is thin, ambiguous or conflicting, the product says so instead of guessing.

## Positioning
Every factual claim in a draft traces back to a word-for-word quote from a real source, whether a web page or the rep's own uploaded document, and that quote is shown to the reviewer. Most outreach tools produce templated "personalisation". This one verifies before it writes, and stops when it can't.

## Operating Context
- Built for the ASA Case Study (Problem Statement 3, GTM). It runs live in an interview: a happy path plus edge cases (ambiguous prospect, insufficient research, conflicting or stale information).
- Runs on a local machine (Next.js and SQLite). Research uses Tavily, and the model is Anthropic Claude or an OpenRouter model, including free tiers with daily request limits.
- Inputs: a form, PDF documents, and CSV files (prospect lists or CRM exports) for the prospect, plus documents describing the sender's own company and offering.
- Output: a draft for human review. **Nothing is sent without the rep's confirmed approval**; with Gmail connected, approval can send the exact approved version, otherwise it only records the review.

## Capabilities and Constraints
- Pipeline stages: validate, resolve identity, research, extract signals, verify evidence, rank and select hook, draft, quality and claim check.
- Statuses: queued, running, needs clarification, not enough signal, ready for review, approved, failed.
- Uploaded documents are evidence. Their quotes are verified like web sources and labelled "From your document". Sender-profile documents are the trusted source for claims about the sender's own product.
- CSVs with several prospects: the rep picks one row to fill the form, or queues several rows (at most 10 at once).
- Constraints: sending only on an explicit, confirmed approval through the rep's own Gmail (opt-in, send-only scope), never in the background; no scraping of login-walled sources (LinkedIn); API keys stay on the server; free-tier quotas are scarce.

## Evidence on Hand
- No real customers, testimonials or metrics exist. None may be invented in the UI or in drafts.
- Demo prospects are public figures and companies (`scripts/demo-scenarios.json`). Test fixtures are fictional companies.

## Product Principles
1. **Proof is shown, not asserted.** Every fact on screen sits next to the quote and source that back it.
2. **Stopping is a feature.** Not enough signal, ambiguity and conflict are first-class outcomes, presented as clearly as success.
3. **The process is legible while it runs.** Someone watching should understand what stage is happening and why, without narration.
4. **The rep stays in control.** Drafts are editable, versioned and approved by a person; nothing leaves the app except by copy.

## Accessibility & Inclusion
WCAG 2.1 AA as the baseline: keyboard-operable flows, visible focus, sufficient contrast, live progress announced to assistive technology, and reduced-motion support.
