# Implementation Plan — Signal Scout (PS-3: Personalised Outreach, from Prospect to Draft)

> Living document. Update it whenever an implementation decision changes. Agent rules are in `CLAUDE.md`.

## 1. Requirements source
The repo started empty, and no project `README.md` existed. Requirements come from:
- **ASA Case Study — Candidate Guide (PDF), PS-3 · GTM.** "Build a process that takes a prospect as input and produces a personalised outreach draft as output, grounded in something real about that person, ready for a human to review before it goes anywhere." It asks for 2–4 self-defined edge cases. Deliverables are a live, runnable process with an intuitive UI, including a **live run view** (each stage as it executes) and a **dashboard** (history, status and outputs across runs), plus a 5-minute demo.
- **The build brief:** input validation, real research with source URLs, signal extraction and ranking, hook selection with a rationale, a concise draft with a CTA, mandatory human review with no auto-send, persistent run history, failure handling, and three required edge cases (insufficient, ambiguous, conflicting/stale).

## 2. Requirements traceability
| # | Requirement | Implementation | Verified by |
|---|---|---|---|
| R1 | Prospect input: any one of name, company, role, LinkedIn, website, notes, a PDF, or a CSV row (none mandatory); sender input by form or PDF/CSV | `src/lib/pipeline/validate.ts` (zod), `/runs/new` form | `tests/unit/validate.test.ts`, API test |
| R2 | Input validation with clear errors | zod field errors → 400 + inline form errors | unit + API tests |
| R3 | Real public research (news, funding, hiring, interviews, priorities) | `stages/research.ts` → `TavilyProvider` | pipeline test (fixtures recorded from real responses), `npm run smoke` |
| R4 | Source URLs and evidence kept with findings | `sources` + `signals` tables; signal → `source_id` + `evidence_quote` | pipeline tests |
| R5 | Never fabricate facts or sources | deterministic evidence-quote verification (`verify.ts`); guard claim check | `verify.test.ts`, `guard.test.ts` |
| R6 | Extract signals, assess relevance, select hook, explain why | `stages/extractSignals.ts`, `scoring.ts`, `stages/rank.ts` | `scoring.test.ts`, pipeline happy path |
| R7 | Concise, natural draft: signal + role link + value prop + CTA, no flattery | `stages/draft.ts` + `guard.ts`; the value comes from the run's chosen offerings ("what it does") (`pitch.ts`): best fit leads, others named | `guard.test.ts`, pipeline |
| R8 | Editable draft; explicit human review before anything is sent | draft versions + `approve` endpoint; "Edit with AI" (`stages/revise.ts`, `reviseRunDraft`) rewrites from the rep's instruction as a new, fully re-guarded version; optional Gmail send only on a confirmed approval (`src/lib/gmail/`, `checkSendable` before approving) | `tests/unit/api.test.ts`, `tests/unit/revise.test.ts`, `tests/unit/gmail.test.ts`, UI check |
| R9 | Live run view with per-stage status | `run_events` table + SSE `/api/runs/[id]/events` + `StageTimeline` | pipeline event assertions, manual UI check |
| R10 | Dashboard: history, statuses, timestamps, outputs; survives refresh | SQLite persistence, `/` dashboard | manual + repo test |
| R11 | Clear handling of failures, missing info, research limits | typed `PipelineError`, terminal statuses, limitations panel | pipeline failure tests |
| R12 | Edge case: insufficient research | `insufficient_research` status, no personalised hook | pipeline test + demo |
| R13 | Edge case: ambiguous prospect → clarification | `needs_clarification` + `/clarify` resume | pipeline test + demo |
| R14 | Edge case: conflicting / stale info flagged | `freshness.ts`, conflict pass, hook eligibility rules | pipeline test + demo |
| R15 | Tests: happy path, invalid input, API failure, draft failure | `tests/pipeline/*` | `npm test` |
| R16 | Secrets never exposed | `config.ts` (server-only), `redact()`, health endpoint returns booleans | `config.test.ts` |
| R17 | Docs: setup, env, usage, architecture, limitations, demo | `README.md`, `docs/DEMO_SCENARIOS.md` | review |
| R18 | `CLAUDE.md` agent manual | `CLAUDE.md` | review |

## 3. Architecture
- **One Next.js app** (Node runtime). API route handlers call `src/lib`. The pipeline runs **in-process** in the background after `POST /api/runs` returns `202`, with concurrency 2. This needs a long-lived Node server (local or Docker), not serverless.
- **Persistence:** SQLite file at `DATA_DIR/app.db` (default `./data`). Tables: `runs`, `run_events`, `sources`, `signals`, `drafts`, `settings`.
- **Live view:** each stage writes `run_events` rows. The SSE endpoint replays every event for a run and then tails new ones by polling the DB every 500 ms, so a refresh or reconnect never loses state and works across server restarts.
- **Providers behind interfaces:** `SearchProvider` (Tavily) and `LlmProvider` (Anthropic). The runner gets them by dependency injection; tests pass fixture-backed fakes. Product code always builds the real ones and fails fast if keys are missing.

### Stage flow
```
validate → resolve_identity ──ambiguous──▶ [needs_clarification] ──user clarifies──▶ resolve_identity
                │not_found ─▶ [insufficient_research]
                ▼ resolved
            research ─all queries failed─▶ [failed]
                ▼
         extract_signals → verify (evidence, freshness, reliability, corroboration, conflicts)
                ▼
            rank_hook ──no eligible hook──▶ [insufficient_research]  (optional: labelled role-based draft)
                ▼
             draft ─LLM failure─▶ [failed] (retry draft keeps research)
                ▼
             guard (claim check, length, flattery, placeholders, stale wording)
                ▼
         [awaiting_review] ──human edits / approves──▶ [approved]   (never sent)
```

### Run statuses
`queued | running | needs_clarification | held | insufficient_research | awaiting_review | approved | sent | failed | stopped`

### Stage statuses
`pending | running | succeeded | warning | failed | skipped`

## 4. Ordered tasks
1. Scaffold Next.js + TS + Tailwind + Vitest + ESLint. Add `.env.example`, `.gitignore`, and `data/` in `.gitignore`.
2. `config.ts`: env parsing, `redact()`, `getHealth()`.
3. DB schema and repo (runs, events, sources, signals, drafts, settings). Seed the default sender profile.
4. Pure modules: `validate`, `freshness`, `sourceReliability`, `sanitize`, `scoring`, `verify` (evidence match, corroboration), `guard` (deterministic checks), each with unit tests.
5. Providers: `TavilyProvider` (search with timeout, retry and zod-parsed response) and `AnthropicProvider` (`parse` helper with zod output, stop_reason handling).
6. Stages and runner: event emission, error capture, clarify/resume, regenerate and role-based draft.
7. API routes: runs create/list/detail, events (SSE), clarify, draft (edit/regenerate/approve/role-based), settings, health.
8. UI: dashboard, new-run form, run view (timeline, identity, sources, signals, hook, draft editor, guard warnings, limitations), settings.
9. Pipeline tests with realistic fixtures for every scenario in §6.
10. Smoke script, Dockerfile, docker-compose, README, DEMO_SCENARIOS.
11. Verification: typecheck, lint, test, build, manual UI run, and a live smoke run if keys exist.

## 5. Key design decisions
- **Deterministic verification over trust.** The LLM proposes signals, but code decides whether a signal is verified (the quote must appear in the fetched source text), how fresh it is (dates) and how reliable the source is (domain tiers). The LLM never gets the final say on facts.
- **Scoring:** `score = relevance × freshnessWeight × reliability × (1 + 0.15 × min(extraDomains, 2))`. Freshness weights: fresh 1.0, aging 0.7, unknown 0.5, stale 0.4. Hook threshold: 0.35. A hook must be `verified` and not `conflicting`. With these weights, a stale signal only qualifies when it is highly relevant and comes from a reliable source.
- **Conflicts:** an LLM pass compares verified signals and returns conflict groups, each with a reason. Every signal in a group is marked `conflicting` and excluded from the hook. There is deliberately no "more authoritative side wins" override, because the human resolves conflicts. The UI shows the members and the reason.
- **Suspicious sources:** pages whose text tries to instruct an AI are kept and shown, but their reliability is set to 0.05 and any finding citing them is rejected.
- **Links in drafts:** only the sender's own website is allowed. A researched domain is not trusted for links, because a hostile page could plant its own URL.
- **Stale hooks:** a stale signal only passes the threshold when highly relevant and reliable. If it is chosen, the draft prompt and the guard both forbid "recent/recently/just" wording, and the UI shows a stale caveat.
- **Identity:** the LLM classifies the search results. In code, `resolved` also requires the stated company (or domain) to appear in at least one result, otherwise the result is downgraded to `ambiguous` or `not_found`.
- **Prompt injection:** source text has control characters stripped, is capped in length, and is wrapped in `<untrusted_source id=…>` blocks. System prompts say this content is data. No tools are exposed. Output is schema-constrained, and a verified quote must literally exist in the source.
- **Sending (v6, user's choice):** approval can send through the rep's Gmail when connected and enabled. The send is checked before approving, confirmed in the browser, sent once, never retried automatically, and recorded as status `sent` with a receipt. Without Gmail, approval only flips status and Copy is the way out.

## 6. Edge cases and test scenarios
| Scenario | Trigger | Expected |
|---|---|---|
| Happy path | Well-covered prospect with recent news | `awaiting_review`, hook with verified evidence and URL, draft ≤120 words, no guard errors |
| Insufficient research | Obscure or invented prospect, or only irrelevant results | `insufficient_research`, limitations listed, no personalised draft; a role-based draft only on explicit request, labelled |
| Ambiguous prospect | Common name, weak identifiers, several matching people | `needs_clarification` with candidates; resumes after the user picks one or adds details |
| Conflicting info | Sources disagree, e.g. on a funding amount | signals marked `conflicting`, not used as hook; next-best verified hook used or insufficient |
| Stale info | Signals past their type's recency window (hiring 60/120 days, funding 180/365, …) | stale flagged; hook rejected, or used with a caveat and no "recent" wording |
| Irrelevant signal | Real signal with no link to the offer (`offerLink` null) | relevance capped at 0.3, never the hook |
| Job change | Sources call the person a former employee | `needs_clarification`: "now at X" vs "still at Y"; nothing pitched to the old company |
| Bad news | Layoffs, breach, lawsuit… | never the hook or supporting finding; "On hold" banner; approve needs `acknowledgeBadNews` |
| Contact list | Prospect matches do-not-contact or an existing relationship | `held` before any search; opt-out can't be overridden or sent to; relationship → "Research anyway" |
| Fake personalisation | Draft shares < 2 distinctive words with its hook | `generic_personalisation` warning, confidence low |
| Overused hook / guess as fact | Funding or award hook; "I can see you're struggling…" | funding/award scored ×0.85; `overused_opener` and `assumption_as_fact` warnings |
| Draft expiry | Draft older than its window (hiring 14 days, funding 30, role-based 45…) | approve and send refused (409); "Research again" |
| Invalid input | Every field empty, bad URL | 400 with field errors, no run created |
| Partial input | Only a company, website, LinkedIn URL, role or note | Company-level research. No invented person, a neutral greeting and a suggested recipient. Vague input leads to clarification or insufficient. |
| Search failure | Tavily 5xx or timeout on every query | `failed` at `research` with a clear message |
| Partial search failure | Some queries fail | run continues; research stage `warning` |
| Draft failure | LLM error or refusal during drafting | `failed` at `draft`, research kept, "Retry draft" works |
| Prompt injection | Source text says "ignore previous instructions…" | ignored; output contains no injected content |
| Missing keys | `ANTHROPIC_API_KEY` / `TAVILY_API_KEY` unset | run fails fast at the first stage needing it; UI banner |

## 7. Assumptions log
1. Requirements come from the case-study PDF plus the brief. The `~/Downloads/README.md` (payment service) is unrelated and ignored.
2. The value proposition comes from an editable **sender profile** (Settings), seeded with a neutral example the user should replace.
3. LinkedIn is not scraped (ToS, login-walled). A LinkedIn URL is used as an identifier, and public, indexed activity shows up only through web search.
4. Single-user, local tool: no auth. Run on a long-lived Node server (local or Docker), not serverless.
5. Demo prospects are real public people and companies picked during the build. Live results drift, so `docs/DEMO_SCENARIOS.md` lists backups.
6. Next.js 16 (latest at build time) is used instead of the 15 in the first draft; App Router APIs are unchanged for this use.
7. Default model `claude-opus-5-5`, overridable with `ANTHROPIC_MODEL`. Calls use structured outputs and the server-side refusal fallback (`fallbacks: "default"`).
8. Live demo prospects (`scripts/demo-scenarios.json`) are public figures and companies, plus one fictional small business for the insufficient-research case (the case study explicitly allows made-up prospects).

## 8. Verification status
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | Clean |
| `npm test` | 152 tests pass (unit, pipeline and API routes); also passes with `TZ=America/Los_Angeles` |
| `npm run build` | Clean, no warnings |
| App run without keys (prod server) | Banner shown; invalid input gets a 400; a run fails at resolve_identity with "TAVILY_API_KEY is not set"; SSE replays events |
| UI states (dashboard, ready for review, clarification, insufficient, conflicting/stale, failed, new run, mobile 390px) | Visually checked against a scratch database seeded from the test fixtures (outside the repo) |
| Standalone bundle (what Docker runs) | Serves pages, writes SQLite, runs the pipeline |
| `npm run smoke` against live APIs | **Run 2026-11-05** with the user's approval (5 runs, OpenRouter free model + Tavily). Happy path reached Ready for review twice (after fixing three defects the first live run exposed); insufficient stopped correctly; the ambiguous inputs did not pause live (model judgment; see DEMO_SCENARIOS). |
| `docker compose up --build` | **Not run: Docker daemon not running in the build environment.** The standalone server it uses was verified. |

## 9. Change log
- v1: initial plan.
- v2 (implementation):
  - Next.js 16 instead of 15.
  - Test fixtures are hand-written **fictional** companies shaped like Tavily responses, not recorded real responses. No keys were available to record, and fictional data keeps tests from asserting facts about real people. Live behaviour is covered by `npm run smoke`.
  - Added prompt-injection source flagging, the sender-only link rule and the identity `personConfirmed` flag (company confirmed but person not publicly visible means company-level research plus a limitation).
  - Human edits re-run deterministic checks only, and the UI states that the AI claim audit was not re-run.
  - A failed draft regeneration keeps the existing draft instead of failing the run.
- v3: added an **OpenRouter LLM backend** (`src/lib/providers/openrouter.ts`) so the app can run on free models.
  - Selected by `LLM_PROVIDER`, or inferred from which key is set. Claude stays the default.
  - Uses strict `json_schema` output from zod's own JSON Schema conversion, with `provider.require_parameters: true`.
  - Replies are validated with the same zod schemas, and the model gets one corrective retry when a reply doesn't match.
  - Daily free-limit 429s aren't retried.
  - Verification logic is unchanged, so model quality affects how many findings are verified, never whether unverified facts can reach a draft.
  - ⚠ Not yet verified against the live OpenRouter API.
- v4: **no prospect field is mandatory.** Any one of name, company, website, LinkedIn URL, role or notes starts a run.
  - Identity searches are built from whatever was given.
  - Without a confirmed person, research is company-level: no interview search, and person findings are rejected.
  - A model-suggested name is only kept if a source confirms it.
  - Drafts greet with "Hi there" and store a `recipientHint` (new `drafts.recipient_hint` column, added automatically to existing databases). The guard flags any greeting that names an unspecified person.
  - Sender profile fields are optional too.
  - Dev fix: `allowedDevOrigins` now trusts this machine's own network addresses. Without it, opening the dev server via a LAN IP silently disabled every form, which caused the reported "Save profile not working".
  - UI polish: authored SVG icons replace text glyphs, the forms are grouped with dirty and saved states, filter buttons use `aria-pressed`, browser surfaces are themed, and runs without a name are labelled by the resolved company.
- v5 (risk remediation, documents, redesign):
  - Fixed the findings in `docs/EDGE_CASES_AND_RISK_ASSESSMENT.md` (see its Remediation status section).
  - Added PDF and CSV upload for prospects (as verified evidence; a CSV contributes only the chosen row; batches of up to 10 runs) and for the sender profile (seller material for drafting and the claim audit, plus "Fill profile from this").
  - Drafts are now structured (greeting, opening, insight, value, cta, P.S., signoff), 90–200 words, with alternate subjects and a rationale.
  - Redesigned the UI in the Herbarium Accession direction chosen on the impeccable decision page (PRODUCT.md, DESIGN.md, `.impeccable/`), with a live accession-ledger pipeline diagram.
  - Live testing exposed and fixed three defects: years tripping the number check, "other" typing capping scores, and dates missing from the claim audit. A claim whose numbers overreach now falls back to its quote, and empty model replies are retried.
- v6 (Gmail sending, user-requested):
  - The user chose "auto-send on approve" over opening Gmail or creating a draft. This deviates from PS-3's review-before-send wording, but every send still needs a person's click and confirmation.
  - Added an optional prospect `email` field (form and CSV), never researched or shown to the model.
  - Gmail OAuth (`gmail.send`, `openid`, `email`) with a state cookie; the connection and its tokens are stored in settings; status `sent` with `sent_json` (migration 3).
  - Approve & send / Approve only / Send now in the draft panel; a Gmail panel on Sender profile with a send-on-approve toggle and Disconnect (revokes).
  - Safeguards: pre-approval `checkSendable`, an in-process lock against concurrent sends, no automatic retry, header-injection-safe MIME, Google token redaction.
  - Tests: `tests/unit/gmail.test.ts`. Not verified live: no Google OAuth client was available in development.
- v7 (priority edge cases from the outreach brief):
  - Draft confidence (high/medium/low) with its basis (person/company/role) and reasons.
  - `offerLink` on findings (signal → problem → offer); unlinked findings are capped below the hook threshold.
  - Job change pauses with new/old company candidates (`currentCompany` from identity).
  - Bad news (`sensitive`, deterministic) is never a hook; the draft is held until the rep acknowledges it.
  - Contact list in Sender profile (do-not-contact, existing relationships), checked before research, after identity and before any send; new status `held` (migration 4, `hold_json`).
  - Recency windows per signal type; swap test; obviousness penalty for funding/award; congratulations and assumption-as-fact checks; draft expiry by hook type.
  - Tests: `tests/pipeline/edge-cases.test.ts`. Not live-tested.
- v8 (demo hosting): `render.yaml` (free Docker web service), Basic-auth app password via `APP_PASSWORD` in `src/proxy.ts` (replaced in v18 by Google sign-in) (`/api/health` exempt for UptimeRobot), Render hostname trusted automatically. The Docker image was built and run locally with Render's settings (port 10000, 512 MB): auth, host guard, CSRF and a PDF upload all work. Not yet run on Render itself.
- v9 (Outreach dashboard):
  - New `/outreach` page: tiles, funnel, action queue, sent log with Gmail links, sends per day, and replies by hook type (`src/lib/outreach/stats.ts`, pure and unit-tested).
  - Added the `gmail.metadata` scope (user-approved) for header-only reply, bounce and auto-reply detection on threads the app sent (`src/lib/gmail/tracking.ts`). Sends now store `threadId`.
  - Checks run on page open and on *Check replies*, throttled to once every 5 minutes. Replied and bounced are final states.
  - Existing connections must reconnect once to grant the new scope.
  - Tests: `tests/unit/outreach.test.ts`. Not verified live: needs a real Gmail reply and bounce.
- v10 (Edit with AI, user-requested):
  - The draft panel has *Edit with AI*: the rep types an instruction (rewrite, tone, length, grammar, a different finding) or a question (about the sources, findings or wording). `POST /api/runs/:id/draft/revise` calls the configured LLM (task `revise_draft`, no tools, zod-validated output) synchronously.
  - The model sees verified, non-sensitive findings, excerpts of non-suspicious sources wrapped as untrusted data (for answering questions only; facts that appear only there may not enter the email), the seller profile and material, and the editor's current text including unsaved edits.
  - A changed email is saved as a new version (`author: "ai"`, `notes.revision` with the instruction and the AI's note) after the full guard, claim audit included; approval is reset. A question returns an answer and saves nothing. Finding ids the model wasn't shown are dropped.
  - Facts the rep states in the instruction count as the rep's own, like their notes, in the claim audit. Expiry stays with the research. A failed call leaves the draft unchanged; a version saved meanwhile in another tab wins (409).
  - Tests: `tests/unit/api.test.ts` (rewrite, question, unsupported claim flagged, stale version, model failure, empty instruction), `tests/unit/revise.test.ts` (no bad news, rejected findings or suspicious sources in the prompt; role-based drafts get no findings). Not live-tested: no API key was configured.
- v11 (Offerings by sector, user-requested):
  - The sender profile is only about the seller: identity (name, role, company, website), a default CTA, and `sectors[]` of `offerings[]` (what it does, optional CTA, tagged seller documents; the separate value proposition was dropped at the user's request and old text is folded into "what it does"). Version-1 profiles upgrade on read into a "General" sector (`upgradeSenderProfile`). The contact list moved to its own `/contacts` page.
  - New run: "What are you pitching?" with one dropdown per sector; 1-5 offerings, or "Let Signal Scout choose" (all). Required when offerings exist (`buildPitch`). The run stores a snapshot (`runs.pitch_json`, migration 5); runs from before use every current offering in auto mode.
  - Pipeline: research adds one query for the pitched offering names; extraction lists the offerings with ids and returns `offeringId` per finding (ids not pitched are dropped; a sole offering is linked by default; unlinked findings stay capped). `pitchFocus` picks the lead: the hook's offering, else the most-linked, else the first. The draft prompt details only the lead and names the others for a new `alsoOffer` sentence after the value paragraph (chosen mode: every other chosen offering; auto mode: up to two other linked ones). The claim audit and Edit with AI see every pitched offering. Seller documents: company-wide plus those tagged to pitched offerings.
  - Decision (user): one email leads with the best fit and only names the others. Defaults taken without an answer: "Let Signal Scout choose" exists, and the contact list has its own page.
  - Tests: `tests/unit/pitch.test.ts`, pitch cases in `tests/unit/api.test.ts` and `tests/unit/validate.test.ts`, "offerings the run pitches" in `tests/pipeline/pipeline.test.ts`. A real run with chosen offerings was started against live Tavily/OpenRouter and stored its snapshot; a full live draft with offerings wasn't reviewed.
- v12 (resilience, docs/RESILIENCE_PLAN.md):
  - Fallback chains: LLM (primary → Gemini → Anthropic), search (Tavily → Exa → GDELT) and page readers (Tavily → Exa → Jina → SSRF-guarded direct).
  - Every call is logged (`provider_calls`), with a persisted circuit breaker (`provider_health`), a 20-minute run deadline, preflight (503) and a queue pause.
  - Degrade-not-fail in identity (documents), research and verify review. Resume from the failed stage (`/api/runs/:id/resume`, `from_extract` mode). Unaudited drafts are gated for sending.
  - Cross-verification: an independent claim audit, deterministic hook corroboration, and an identity second opinion.
  - System status panel with *Test connections*; a Degraded banner and "How this run was produced" on runs; the `FAULT_INJECT` demo switch. Migration 6 (it also adds `pitch_json`, for databases that ran it as step 5 before offerings were merged).
  - Tests: `tests/pipeline/resilience.test.ts`, `tests/unit/providers.test.ts`.
  - Not live-verified: Gemini, Exa, GDELT, Jina.
- v13 (stop a run):
  - *Stop run* on active runs (`POST /api/runs/:id/stop`). A queued run is dropped at once; a running one is aborted at once through an `AbortSignal` (the stage promise is abandoned, and late events are suppressed).
  - New `stopped` status, resumable like `failed`. A stopped regeneration keeps the previous draft.
  - Tests: `tests/pipeline/stop.test.ts`.
- v14 (Obsidian redesign, user-requested):
  - Replaced the Herbarium Accession look with the Obsidian system (DESIGN.md): semantic light/dark tokens via `next-themes`, Geist Sans/Mono, and one obsidian gradient for the brand and the primary action.
  - Navigation moved to sticky top tabs with shared-layout indicators (`motion/react`). Added a ⌘K command palette (navigation only).
  - New primitives in `src/components/ui/`: Button, Dialog/useConfirm (replaces `window.confirm`), Toast, Tabs, Popover, Collapsible and motion helpers. Added route loading, error and not-found pages.
  - Draft review: a "Before you send" checklist (blockers first), a sticky action bar with written disabled reasons, ⌘S / ⌘↵ / E shortcuts, an unsaved-edit guard, a word diff for AI rewrites (`src/lib/ui/diff.ts`), and a single editor mount. Send gating and the confirmation before every send are unchanged.
  - The review behind this (25 UI and 25 UX improvements) is listed in DESIGN.md. Tests: `tests/unit/diff.test.ts`.
- v15 (Telemetry direction, user-chosen from four mockups):
  - Every page moved to the Telemetry design (DESIGN.md): a centred pill navbar (Aurora box), Outfit with Martian Mono labels, the cyan-to-lime gradient, and inverted cards. App tokens were aligned with the Telemetry palette in both themes.
  - Primitives were restyled once (Button pills, Badge, PageHeader with a mono label, pill Tabs and SegmentedControl, fields), so the runs list, run view, Settings and Contacts follow. Outreach and New run were rebuilt as compact dashboard and form layouts. Geist fonts were removed.
  - Logic, send gating and confirmations are unchanged.
- v16 (copy trim, user-requested):
  - Removed AI-sounding explanatory text: page descriptions, helper paragraphs under sections and fields, and footnotes. Pages now show titles, mono labels and data.
  - Explanations moved into an accessible `Tooltip`/`InfoTip` (hover and focus, portalled). Buttons explain themselves and give disabled reasons in tooltips. Guardrail labels (inference, stale and bad-news holds) stay visible.
- v17 (Discover, user-requested):
  - `/discover` searches the web for a described set of companies (`src/lib/discover/discover.ts`, `POST /api/discover`). The model only proposes names; each is kept only if its name appears in a cited source, websites are kept only when a cited source mentions the domain, and LinkedIn or injection-like pages never reach the model. Contact rules flag do-not-contact and relationships.
  - Picking a company opens New run prefilled (`?company=&website=`); validation and duplicate checks are unchanged. Nothing runs or sends from Discover. Tests: `tests/unit/discover.test.ts`.
- v18 (Google sign-in, user-requested):
  - "Sign in with Google" replaces the Basic-auth password prompt. One OAuth grant signs the rep in and connects the Gmail approved drafts are sent from, so there's no separate Connect Gmail step on Sender profile (it now shows the *Sending account*, the send-on-approve toggle and *Revoke Google access*).
  - `src/lib/auth/session.ts` (pure, Web Crypto): HMAC-signed HttpOnly session cookie (7 days), `ALLOWED_EMAILS` matching, safe `next` paths. `src/proxy.ts` requires a session for everything but `/signin`, the OAuth routes and `/api/health` whenever `GOOGLE_CLIENT_ID/SECRET` are set; on Render without them it refuses to serve.
  - Without `ALLOWED_EMAILS`, the first account to sign in becomes the owner (`settings.owner`) and is the only one let in. The allow check runs before any token is stored.
  - Signing in without the send scope is allowed, but `checkSendable` refuses until it's granted. Consent is forced only until a refresh token is stored.
  - Top bar: Search is its own round button beside the nav pill (no ⌘K label; the shortcut still works), with the theme toggle and an account menu (Sign out) on the right.
  - Tests: `tests/unit/session.test.ts`, sign-in callback cases in `tests/unit/gmail.test.ts`. Verified in a production build: gating, 401s, forged-cookie rejection, the Google redirect. A real Google sign-in wasn't exercised here.
- v19 (Contacts, user-requested):
  - Relationships carry a type (`customer`, `open_deal`, `past_contact`, `partner`, `other`) shown before the note on a held run; older entries without one still work.
  - `src/lib/contacts/rules.ts` (pure): entry kind (email/domain/company), normalisation (lowercase, URL to domain, shared-mail domains refused), list validation and de-duplication, shared by the page, `PUT /api/settings/contacts` and the run checks. Lists hold up to 5,000 entries each.
  - `src/lib/contacts/importer.ts` (pure, browser-side): CSV/TSV/paste parsing with header detection, column guessing with per-row fallback, CRM stage to type, import preview (new / duplicate / skipped with reasons), CSV export with formula cells defused. Files are never uploaded.
  - Contacts page: explainer, *Check a contact*, structured add rows, type badges, inline type/note edits, filter, paging, Import / Export / Clear per list.
  - Tests: `tests/unit/contacts.test.ts`. Verified in a production build with a CRM-style CSV.
