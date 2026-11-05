# Signal Scout

Personalised outreach, from prospect to draft. **ASA Case Study, Problem Statement 3 (GTM).**

A rep enters a prospect. Signal Scout:
1. confirms who they are, and stops to ask if several people match;
2. searches public sources (news, funding, hiring, interviews, strategic priorities);
3. extracts candidate signals and **verifies each one against the exact source text**;
4. ranks the verified signals and picks the strongest hook for this person;
5. writes a short draft and audits every factual claim in it.

The rep then reviews, edits and approves. **Nothing is sent without that approval.** If the rep connects Gmail (optional), *Approve & send* emails the exact approved version after a confirmation; otherwise approval only records that a person reviewed the draft.

Every run is persisted. The dashboard shows history and status, and the run page shows each stage live as it executes.

---

## Quick start

Requirements: Node.js 22.12+ or 24 (developed on Node 24), npm, a Tavily API key, and an LLM key: **either** Anthropic **or** OpenRouter (which offers free models).

```bash
npm install
cp .env.example .env.local      # then fill in TAVILY_API_KEY and one LLM key
npm run dev                     # http://localhost:3000
```

Production mode: `npm run build && npm start`.

### Docker

Free demo hosting on Render with UptimeRobot (data resets on restart): see [docs/DEPLOY_RENDER.md](docs/DEPLOY_RENDER.md).

```bash
cp .env.example .env            # fill in the keys
docker compose up --build       # http://localhost:3000, data persisted in a named volume
```

### Configuration

| Variable | Required | Purpose |
|---|---|---|
| `TAVILY_API_KEY` | yes | Web and news search, plus reading the company website ([get a key](https://app.tavily.com)) |
| `ANTHROPIC_API_KEY` | one LLM key | Claude does identity matching, signal extraction, conflict checks, drafting and the claim audit |
| `OPENROUTER_API_KEY` | one LLM key | Alternative LLM backend through [OpenRouter](https://openrouter.ai/keys), including free `:free` models |
| `LLM_PROVIDER` | no | `anthropic` or `openrouter`. If blank: Anthropic when its key is set, else OpenRouter. |
| `ANTHROPIC_MODEL` | no | Override the Claude model (default `claude-opus-5-5`) |
| `OPENROUTER_MODEL` | no | OpenRouter model id; must support structured outputs (default `nvidia/nemotron-3.5-super-vl:free`) |
| `ALLOWED_HOSTS` | no | Extra hostnames the app may be served under (comma-separated). localhost, IP addresses and `.local` names always work; any other host is refused, to block DNS rebinding. |
| `DATA_DIR` | no | Where the SQLite database lives (default `./data`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Google OAuth web client, to send approved drafts from your Gmail ([setup](docs/LIVE_TESTING_SETUP.md#gmail-sending-optional)). Blank keeps approval review-only. |
| `APP_PASSWORD`, `APP_USERNAME` | when hosted | A password prompt in front of the whole app (username defaults to `demo`). Required on any public host; `/api/health` stays open for uptime monitors. |
| `GOOGLE_REDIRECT_URI` | no | OAuth redirect (default `http://localhost:3000/api/gmail/callback`); must match the client's authorised redirect URI |

Every sender profile field is optional. Drafts stay general where it's empty.

Keys are read only on the server. They are never sent to the browser or written to logs, since log output passes through a redaction helper. If a key is missing, the UI shows a banner and runs fail at the first step that needs it, with a message saying which key to add. The app never falls back to fake data.

---

## Using it

1. **Sender profile.** Describe who you are and what you sell. Drafts tie the prospect's situation to this value proposition. A neutral example is seeded; replace it.
   - **Drop your own documents** (one-pagers, decks, case studies as PDF or CSV). Drafts draw on them for claims about your product, and the claim audit checks those claims against them.
   - *Fill profile from this* pre-fills the profile from a document (one model call). You review the result before saving.
2. **New run.** Fill in whatever you know. **Any one field is enough**: a name, a company, a website, a LinkedIn profile, a role, a note, or a file. A name plus the company website gives the most accurate research.
   - **Drop a PDF** (an account brief, call notes) and it becomes evidence. Its quotes are verified word for word like web pages and labelled "From your document". Scanned PDFs without text are refused with a clear message.
   - **Drop a CSV** of leads (CRM exports work: name, title, company, email, LinkedIn, notes columns are mapped automatically, and a work email's domain becomes the website). *Use* a row to fill the form, or tick up to 10 rows to research them all. Each run sees only its own row as evidence, never the other prospects in the file.
   - **Duplicate check.** If you researched the same prospect in the last 24 hours, you're offered that run instead of paying for the same research twice.
   - **Without a name**, research is about the company. The draft opens with "Hi there", never invents a name, and suggests who to send it to (e.g. "CFO or VP Finance").
   - **Vague input** (e.g. only a role, or a company name several firms share) leads to *Needs clarification* or *Not enough signal*, not a guess.
3. **Watch the run.** The **accession ledger** on the left is the live pipeline diagram. The eight stages sit on a line that fills in as each completes; the running stage pulses, and the two exits (needs clarification, not enough signal) light up only when taken. A single status line announces progress to screen readers. It's driven by server-sent events that replay from the database, so refreshing or leaving and coming back loses nothing.
4. **Review the outcome.**
   - **Ready for review.** The hook is "mounted" with its verbatim quote, a collection label (source, date, accession id, reliability) and a pinned **determination slip**. Every finding carries one too (verified, rejected or conflicting).
     - **The draft is structured:** a hook, an insight for their role, your value, and one ask, about 120–190 words, plus an optional P.S. drawn from a second verified finding.
     - **It comes with:** alternate subject lines, a "Why this draft" rationale, checks and a claim audit.
     - **Editing and approval:** *Save edits* creates a new version. *Approve vN* approves that exact version; if someone else changed the draft in the meantime, you're shown the newer one instead. *New version* reuses the same research.
     - **Sending (optional, Gmail).** Connect Gmail under *Sender profile*. With *Send when I approve* on, the button becomes *Approve & send*: after a confirmation showing To and From, the exact approved version is emailed from your account and the run becomes **Sent**, with a receipt (recipient, time, Gmail message id). *Approve only* still records the review without sending. If a send fails, the run stays approved, the reason is shown, and *Send now* retries.
       - The recipient comes from the prospect's *Email* field (or a CSV email column) and can be changed in the draft's *To* field. Emails are never researched or shown to the model.
       - Safeguards: nothing sends without a click and a confirmation; a draft with blocking check issues, without a valid recipient, or not the latest version is refused before it's approved; a version is sent at most once and a sent draft is read-only; sends are never retried automatically. The app asks for `gmail.send` plus `gmail.metadata` (headers only: sender, time, subject), so it can see replies and bounces on threads it sent but never reads email bodies. Tokens stay in the server's database and are revoked on *Disconnect*.
     - **Deleting:** *Delete run* removes the run and everything it collected.
   - **Needs clarification.** Pick the right candidate, each with an evidence link, or add details and search again.
   - **Not enough signal.** You see what was searched and why nothing qualified. You can ask for a *role-based draft*, which is labelled as such and makes no claims about the prospect.
   - **Failed.** You see the error. Earlier findings are kept, and you can retry the draft or rerun from the start.
5. **Outreach (home page).** What happened after approval:
   - **Tiles:** needs review (and expiring soon), sent, delivered, replied (with reply rate) and bounced.
   - **Funnel:** researched → draft ready → approved → sent → delivered → replied.
   - **Needs your action:** failed sends, bad-news holds, drafts to review by use-by date, clarifications, relationship holds and expired drafts.
   - **Sent emails:** each with its status and a link to the Gmail thread.
   - **Charts:** sends per day, and replies by hook type.
   - **How tracking works:** on page open, or with *Check replies*, it reads only the headers of threads it sent, throttled to once every 5 minutes. "Delivered" means no bounce was seen, because Gmail has no delivery receipts. Opens aren't tracked.
6. **Runs** (`/runs`). All runs with status (and the live stage), hook, verified findings out of sources, active time and start time. You can filter by status or search, and it auto-refreshes while runs are active. A row whose status changes flashes once.

---

## How it works

```
validate → resolve identity ──ambiguous──▶ needs clarification ──rep picks / adds detail──▶ (resume)
                 │ not found ─▶ insufficient research
                 ▼
             research (5 parallel searches, ≤25 sources, dedup by URL)
                 ▼
          extract signals (Claude, schema-constrained, must quote its source)
                 ▼
          verify  ── deterministic: quote must exist verbatim in the cited source; source must mention the company/person;
                 │                   freshness from dates; reliability from domain tier; AI-instruction pages rejected
                 └─ Claude: group same-fact signals (corroboration) and flag contradictions (conflicts)
                 ▼
          rank & select hook  ── score = relevance × freshness × reliability × corroboration; threshold 0.35
                 │ nothing qualifies ─▶ insufficient research (role-based draft only on request)
                 ▼
          draft (Claude) → guard (length, flattery, placeholders, links, stale-as-recent, unsupported claims)
                 ▼
          ready for review ──human edits / approves──▶ approved   (never sent)
```

### Design decisions

- **The model proposes and code decides.** Claude suggests signals, but a signal is only *verified* if its evidence quote appears word for word in the source text the model was shown. Code also computes freshness from dates, reliability from the domain, and the hook score. A fabricated quote is rejected automatically and shown struck through in the UI.
- **Ambiguity stops the run.** Identity resolution can return `ambiguous`, with candidates and evidence links. The run pauses rather than researching a guess. Code also downgrades a "resolved" answer if none of its cited sources mention the company.
- **Conflicts and staleness are surfaced, not smoothed over.** Contradicting signals, such as different funding amounts, are all marked *conflicting* and can't be the hook. Signals over 12 months old are flagged *stale* and heavily down-weighted. If one is still chosen, the draft prompt and the guard both forbid calling it recent.
- **Web content is untrusted.** Source text is sanitised and wrapped in `<untrusted_source>` delimiters that a page cannot close or forge. The system prompts say this content is data. Claude is never given tools, and its output is schema-constrained. Pages containing instructions aimed at an AI are flagged, kept visible, and never trusted. Drafts may only link to the sender's own website.
- **Every draft is audited.** A second Claude pass lists each factual claim and maps it to a verified signal. Unsupported claims about the prospect are flagged for the reviewer. If the audit itself fails, the UI says so instead of passing silently. Human edits re-run the deterministic checks, and the UI notes that the AI audit wasn't re-run.

### Stack and layout

Next.js 16 (App Router, Node runtime), TypeScript (strict), Tailwind CSS 4, SQLite (`better-sqlite3`), `zod`, `@anthropic-ai/sdk` (structured outputs, server-side refusal fallback) or OpenRouter's chat completions API (strict JSON-schema output, routed only to providers that enforce it), Tavily REST API, Vitest.

**About OpenRouter free models:** they work through the same pipeline and the same verification. A weaker model can't slip invented facts past the verbatim-quote check or the claim audit. In practice it produces more rejected findings and more "Not enough signal" results. The free tier allows 20 requests/minute and 50/day (1,000/day after a one-time $10 credit purchase). A full run uses about 5 requests, and a failed schema check can add one correction request.

```
src/app/                 pages (/, /runs/new, /runs/[id], /settings) and API routes (src/app/api)
src/lib/pipeline/        runner + stages; pure modules: validate, freshness, sourceReliability,
                         sanitize, evidence, scoring, guard
src/lib/providers/       TavilyProvider (search), AnthropicProvider / OpenRouterProvider (LLM), behind interfaces
src/lib/db/              SQLite schema + repository
src/components/          UI (dashboard, form, run view, draft editor)
tests/                   unit/, pipeline/ (full runner with fixture providers), fixtures/
scripts/smoke.ts         live end-to-end run against the real APIs
```

The pipeline runs in-process on the Node server, two runs at a time. Each stage writes events to SQLite, and the run page streams them over SSE. If the server restarts mid-run, interrupted runs are marked failed with an explanation instead of being left "running" forever.

### API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/runs` | Start a run (`202`); `400` with field errors; `409` with the earlier run if the same prospect was researched in the last 24 hours (send `force: true` to run anyway). Optional `documents: [{documentId, rowIndex}]` |
| `GET` | `/api/runs?status=` | List runs |
| `GET` | `/api/runs/:id` | Full run detail |
| `GET` | `/api/runs/:id/events` | SSE stream of stage events (replays history) |
| `POST` | `/api/runs/:id/clarify` | `{candidateIndex}` or extra details; resumes an ambiguous run |
| `PUT` | `/api/runs/:id/draft` | Save a human edit as a new version (`baseVersion` required; 409 if the draft moved on) |
| `POST` | `/api/runs/:id/draft` | `{action: "approve", version, send?, to?, acknowledgeBadNews?}` (409 if not the latest, expired, held for bad news without acknowledgement, or if `send` is set and sending isn't possible; 502 if approved but the send failed), `{action: "send", version, to?}` for an approved draft, `{action: "regenerate" \| "role_based"}` |
| `GET`/`PUT`/`DELETE` | `/api/gmail` | Connection status (address and setting only, never tokens); `{autoSendOnApprove}`; disconnect and revoke |
| `GET` | `/api/gmail/connect`, `/api/gmail/callback` | Google OAuth sign-in and its redirect (state checked against an HttpOnly cookie) |
| `GET`/`PUT` | `/api/settings` | Sender profile |
| `GET`/`PUT` | `/api/settings/contacts` | Contact list: `{doNotContact: string[], relationships: [{match, note}]}` |
| `POST` | `/api/runs/:id/hold` | Research a run held for an existing relationship anyway (opt-outs refuse) |
| `POST` | `/api/settings/extract` | `{documentId}`: suggest profile fields from a sender document (one model call) |
| `POST` | `/api/documents` | Upload a PDF or CSV (multipart `file`, `scope` = `prospect` or `sender`); CSV rows come back mapped to prospect fields |
| `GET` / `DELETE` | `/api/documents?scope=` / `/api/documents/:id` | List or remove uploaded documents |
| `POST` | `/api/runs/batch` | `{documentId, rowIndexes}`: one run per CSV row, at most 10 |
| `DELETE` | `/api/runs/:id` | Delete a finished run and everything it collected |
| `GET` | `/api/outreach` | Outreach numbers from stored runs (no Gmail calls) |
| `POST` | `/api/outreach/check` | `{force?}`: check sent threads for replies and bounces (headers only), then return the numbers |
| `GET` | `/api/health` | Which keys are configured (booleans only) |

---

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest: unit + pipeline + API route tests
npm run build       # production build
npm run smoke       # LIVE: runs scripts/demo-scenarios.json against real Tavily + Claude (needs keys)
```

The automated tests run the real pipeline code with fixture-backed providers. The fixtures are realistic but use **fictional** companies, so no test asserts facts about real people. Each fixture's output is validated against the same zod schema Claude is constrained to. Covered:

| Scenario | Test |
|---|---|
| Happy path: verified, corroborated hook; clean draft; ordered stage events | `tests/pipeline/pipeline.test.ts` |
| Fabricated evidence quote is rejected | pipeline + `tests/unit/evidence.test.ts` |
| Prompt injection in a source: flagged, rejected, delimiters can't be broken, planted link and claim flagged in the draft | pipeline + evidence |
| **Ambiguous prospect:** pauses with candidates, no research on a guess; resumes after a pick | pipeline |
| **Insufficient research:** no hook, limitations explained, role-based draft only on request; identity not found | pipeline |
| **Conflicting and stale information:** conflicting funding amounts flagged; stale hook refused, or allowed with a caveat and "recent" wording flagged | pipeline |
| Invalid input (empty form, malformed URL): 400 with field errors, no run created | `tests/unit/validate.test.ts`, `tests/unit/api.test.ts` |
| Runs from a single field: company-only research with no invented person, an invented greeting name flagged, an ambiguous company resolved by picking a candidate | `tests/pipeline/partial-input.test.ts` |
| Search outage (identity or research), partial research failure | pipeline |
| Draft failure (refusal) keeps research, retry succeeds; failed regeneration keeps the existing draft | pipeline |
| Claim audit unavailable is reported, not hidden | pipeline |
| Missing API keys fail fast with a clear message | pipeline |
| Scoring, freshness, reliability, guard rules, identity guardrails, consistency, redaction | `tests/unit/*` |
| Risk-assessment fixes: full-name and whole-word entity matching, quote stitching, claim-to-quote review and narrowing, grounded dates, syndication, former employees, grounded roles, stale supporting findings, request budget | `tests/unit/evidence.test.ts`, `tests/unit/stages.test.ts`, `tests/pipeline/hardening.test.ts` |
| Documents: real PDF text extraction, scanned-PDF refusal, CSV parsing and CRM mapping, document-only runs, only the chosen CSV row as evidence, seller material in drafting and claim audit | `tests/unit/documents.test.ts`, `tests/pipeline/hardening.test.ts`, `tests/unit/api.test.ts` |
| Security and integrity: cross-site and host-header guard, JSON-only bodies, versioned approve/edit, duplicate detection, run deletion, migrations, owner-aware restart recovery | `tests/unit/requestGuard.test.ts`, `tests/unit/api.test.ts`, `tests/unit/schema.test.ts` |

Live behaviour, meaning real search results and real model output, is exercised with `npm run smoke` and the scenarios in [`docs/DEMO_SCENARIOS.md`](docs/DEMO_SCENARIOS.md). Tests always run against a throwaway data directory (`.test-data`), never your real database.

**Live results (2026-11-05, OpenRouter `nvidia/nemotron-3.5-super-vl:free` + Tavily):**

| Run | Input | Result | Time |
|---|---|---|---|
| Happy path (first) | Eric Glyman, Ramp | Ready for review. Exposed three defects (year digits failing the number check, "other" typing capping scores, the claim audit not seeing dates), all fixed with regression tests. | 314s |
| Happy path (after fixes) | Eric Glyman, Ramp | Ready for review. Product-launch hook (0.85), 6 of 8 findings verified, 153-word structured draft with a P.S. The claim audit's empty reply was then made retryable. | 354s |
| Insufficient | Dana Whitfield, Quietbrook Ceramics (fictional) | Not enough signal (identity not confirmed), with no invented hook | 24s |
| Ambiguous | Michael Chen, Mercury, CFO | The model judged "not found" (no Michael Chen is CFO at any Mercury). The prompt now prefers offering partial matches as candidates. | 31s |
| Ambiguous (bare company) | Mercury, CFO | The model resolved Mercury the fintech confidently and drafted company-level. Live ambiguity depends on the model's judgment; the deterministic test covers the clarification flow. | 287s |

---

## Demo

See [`docs/DEMO_SCENARIOS.md`](docs/DEMO_SCENARIOS.md) for the run order, inputs, expected outcomes and backups. Web results change daily, so do a dry run with `npm run smoke` on the day of the demo.

---

## Outreach edge cases

| Case | What Signal Scout does |
|---|---|
| No usable signal | Falls back person → company → a labelled role-based draft. Every draft carries a **confidence** label (high/medium/low) with what it rests on. Failed searches are reported separately from "found nothing". |
| Interesting but irrelevant | Each finding must name the problem it suggests that your offer solves. Without that link it can't be the hook. |
| Job change | If sources call the person a former employee, the run pauses: "now at X" (research the new company; the move is the opening) or "still at Y". |
| Bad news | Layoffs, breaches, lawsuits and similar are never the hook or mentioned in the draft. The draft is **on hold** until you confirm you still want to reach out. |
| Existing relationship / opt-out | Your **contact list** (Sender profile) is checked before any research. Opt-outs stop the run and can't be sent to; customers, open deals and past contacts stop it with your note and a *Research anyway* option. |
| Wrong person | A person finding needs their full name and the company in the same source; unclear matches pause for you. |
| Stale signal | Recency limits per signal type (a job post goes stale in 4 months, a funding round in a year); undated findings are weighted down. |
| Right company, wrong person | Relevance is scored against the prospect's role. |
| Invented facts | Quotes are matched word for word; a claim audit flags anything unsupported. |
| Fake personalisation | Swap test: a draft that shares nothing specific with its hook is flagged and marked low confidence. |
| Overused hook | Funding rounds and awards score slightly lower than equally good, less visible findings; "congratulations" openers are flagged. |
| Guess presented as fact | Drafts state what was observed and ask about the implication; "I can see you're struggling…" is flagged. |
| Draft goes out of date | Each draft has a use-by date by hook type (hiring 14 days, funding 30, role-based 45). After it, approve and send are refused and you're offered *Research again*. |

## Limitations

- **Coverage depends on public, indexed sources.** LinkedIn is not scraped (it is login-walled and against its terms), so LinkedIn activity is only seen when it is publicly indexed. Very private people produce company-level hooks or an honest "not enough signal".
- **Evidence verification is lexical.** It proves the quote exists in the source. It can't prove that the source itself is correct. That is why reliability tiers, corroboration and conflict checks exist, and why a human approves every draft.
- **Conflict detection uses Claude** to compare claims. It can miss subtle contradictions. Every conflict it does flag is shown with its reason.
- **Freshness uses the event date when the source states one**, else the publish date. Undated pages are marked "date unknown" and down-weighted.
- **Single-user and local.** There is no authentication. Runs execute in-process, so a server restart interrupts in-flight runs, which are then marked failed. A multi-user deployment would need a job queue and auth.
- **Costs:** a typical run makes up to 7 Tavily calls (advanced depth) and 5 LLM calls. OpenRouter free models cost nothing but are rate-limited (50 requests/day), and their availability changes; a run is capped at 14 OpenRouter requests. Free-model runs took about 5 minutes live.
- **Documents:** text PDFs and CSVs only. There is no OCR for scanned PDFs, and no Word or Excel files. Long documents contribute their first ~19k characters as evidence chunks.
- **Live ambiguity is a judgment call.** Whether a vague input triggers *Needs clarification* depends on what the web returns and on the model. A confident model may resolve the most prominent match instead. Adding one more detail is always the fix.
- **Sending is a deliberate deviation from PS-3's "human reviews before anything is sent".** A human still reviews and confirms every send, but the app can now deliver the email itself when Gmail is connected. It's opt-in (no Google keys, no connection, or the toggle off means approval only records the review). Google limits unverified OAuth apps to the test users you add, which suits a single-user local tool.
- **Local by default.** `npm run dev` / `npm start` listen on `127.0.0.1` only, because there's no login. Use `npm run dev:lan` / `npm run start:lan` to open the app to your network, and set `ALLOWED_HOSTS` for any other hostname.

## Project docs

- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md): requirements traceability, architecture, decisions and assumptions.
- [`CLAUDE.md`](CLAUDE.md): instructions and guardrails for AI agents working on this repo.
- [`PRODUCT.md`](PRODUCT.md) and [`DESIGN.md`](DESIGN.md): product brief and the Herbarium Accession design system (tokens, components, rules).
- [`docs/EDGE_CASES_AND_RISK_ASSESSMENT.md`](docs/EDGE_CASES_AND_RISK_ASSESSMENT.md): the risk assessment and the status of each fix.
- [`docs/DEMO_SCENARIOS.md`](docs/DEMO_SCENARIOS.md): reproducible demo and test scenarios.
- [`docs/LIVE_TESTING_SETUP.md`](docs/LIVE_TESTING_SETUP.md): step-by-step guide to running against the real APIs.
