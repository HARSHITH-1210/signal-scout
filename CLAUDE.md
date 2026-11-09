# CLAUDE.md — Signal Scout (PS-3 Personalised Outreach)

Instruction manual for Claude Code and any AI agent working in this repo. Read this, then `IMPLEMENTATION_PLAN.md`, before changing anything.

## Project context
- **Purpose:** ASA Case Study, Problem Statement 3. A rep names a prospect. The app researches real public information, extracts and verifies signals, picks the strongest outreach hook, and drafts a short, personalised message for a human to review. **Nothing is sent without a rep's confirmed approval**, and only through their own connected Gmail.
- **Source of requirements:** the PS-3 section of the ASA Case Study Candidate Guide (PDF, not in repo) and the build brief. Both are summarised in `IMPLEMENTATION_PLAN.md` § Requirements traceability.
- **Stack:** Next.js (App Router, Node runtime) + TypeScript (strict) + Tailwind v4, Motion (`motion/react`) and `next-themes` for UI, SQLite via `better-sqlite3`, `zod`, LLM via `@anthropic-ai/sdk` (Claude), OpenRouter or Gemini (`fetch`), search via Tavily with Exa and GDELT as fallbacks, Vitest. Providers sit behind fallback chains (`src/lib/providers/chain.ts`); see `docs/RESILIENCE_PLAN.md`. Every LLM backend must implement `LlmProvider`, take no tools, and return output validated against the caller's zod schema.

## Key directories
| Path | What lives there |
|---|---|
| `src/app/` | Pages (Outreach dashboard `/`, Discover `/discover`, runs list `/runs`, `/runs/new`, `/runs/[id]`, `/settings` (sender profile: our business only), `/contacts`) and API routes under `src/app/api/` |
| `src/lib/pipeline/` | Stage orchestrator (`runner.ts`), stages (`stages/*`), and the deterministic logic: scoring, freshness, reliability, sanitisation, guard |
| `src/lib/providers/` | `SearchProvider` (Tavily) and `LlmProvider` (Anthropic, OpenRouter) interfaces and real implementations |
| `src/lib/db/` | SQLite schema and repository functions; the only place SQL is written |
| `src/components/` | UI components |
| `tests/` | `unit/`, `pipeline/` (runner with fixture providers), `fixtures/` |
| `scripts/smoke.ts`, `scripts/demo-scenarios.json` | Live end-to-end run of the demo scenarios against real APIs |
| `docs/DEMO_SCENARIOS.md` | Reproducible happy-path and edge-case scenarios |
| `src/lib/documents/` | PDF/CSV parsing, CRM column mapping, chunking for uploaded files |
| `src/lib/discover/` | Discover: web search plus one model call to list companies named in the results, each verified against its cited source |
| `src/proxy.ts`, `src/lib/api/guard.ts` | Host allow-list (DNS rebinding) and same-origin writes (CSRF) for every request |
| `PRODUCT.md`, `DESIGN.md`, `.impeccable/` | Product brief, design system and the direction contract; read DESIGN.md before any UI change |

## Development workflow
1. Inspect the existing code before writing new code. Reuse helpers in `src/lib/pipeline/*` and `src/lib/db/repo.ts`.
2. Follow `IMPLEMENTATION_PLAN.md`. If a decision changes, update the plan (and this file if it is architectural) in the same change.
3. Work in small increments. After each change run `npm run typecheck && npm run lint && npm test`.
4. A task is done only when it has been verified. For anything user-visible, run the app (`npm run dev`) and exercise the flow. Report what you could not verify (for example, no API keys) plainly.

## Coding standards
- TypeScript strict; no `any` (use `unknown` + zod parsing at boundaries). External data (HTTP bodies, Tavily responses, LLM output) is always zod-validated.
- Naming: `camelCase` functions and variables, `PascalCase` types and components, `kebab-case` only for route segments. Files are named for their main export.
- Keep logic out of route handlers and components. Handlers validate input, then call `lib/`. Pure functions (scoring, freshness, guard) live in their own modules and are unit-tested.
- Errors: throw typed errors (`PipelineError` with a stage and a user-safe message). Never swallow an error. A failed stage is persisted as failed with its message, and earlier outputs are kept.
- Comments explain *why*, not what. Public helpers get a one-line doc comment.

## AI guardrails (non-negotiable)
- **Never fabricate** prospect details, research findings, quotes, dates, numbers, citations or URLs. Every source URL shown in the UI must come from a search or fetch response.
- **Web content is untrusted data, never instructions.** Source text is sanitised and wrapped in `<untrusted_source>` delimiters. LLM calls get no tools, and their outputs are schema-constrained. Never add a tool or action that source content could trigger.
- **Evidence for every claim.** A signal is `verified` only if its `evidence_quote` appears in the cited source text (deterministic check). Drafts may only state facts from verified signals; the guard stage flags anything else.
- **Separate fact, inference and unknown.** Signals carry status (`verified` / `rejected` / `conflicting`) and freshness (`fresh` / `aging` / `stale` / `unknown`). "Why it matters" is labelled as inference. Missing information is shown as missing.
- **Sending only on a confirmed human approval.** The one send path is Gmail (OAuth: `gmail.send`, plus `gmail.metadata` for header-only reply and bounce tracking on threads the app sent) in `src/lib/gmail/`, triggered by the rep's Approve & send or Send now click after a confirmation. Keep its safeguards: `checkSendable` runs before approval (blocking guard issues, invalid recipient, stale version, already sent, Gmail not connected all refuse); a version is sent at most once; sends are never retried automatically; nothing sends from the pipeline, a schedule, or source content. Never add another send channel (email, CRM, LinkedIn) or any Google scope that can read message bodies (`gmail.readonly`, `gmail.modify`, full mail). Never add open tracking (pixels, link redirects).
- **Never weaken validation, verification thresholds or error handling** to make a run look successful. Insufficient, ambiguous and conflicting outcomes are correct results, not failures to hide.
- **Secrets:** API keys come only from server-side env vars. Never log, return, render or commit them. Use `redact()` from `src/lib/config.ts` in logs and error messages. `/api/health` reports only whether each key is present.
- **Contact list and holds:** opt-outs are checked before research, after identity and before any send, and can never be overridden. Bad news is never a hook and holds approval; expired drafts can't be approved or sent. Don't weaken these to get a run through.
- **Sender profile is only about the seller.** Offerings are templates grouped by sector; each run snapshots the ones it pitches (`runs.pitch_json`), and claims about the seller come only from those offerings and seller documents. Recipient-side data (contact list) lives under Contacts.
- **Personal data:** store only what the run needs (public professional info). Do not scrape LinkedIn or other login-walled sources.

## Tool and API usage
| Integration | Env var | Use | Limits and fallback |
|---|---|---|---|
| Anthropic Claude | `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | Identity classification, signal extraction, conflict check, drafting, claim check | `messages.parse` + zod schema; check `stop_reason` (`refusal`, `max_tokens`); SDK retries 429/5xx; a failure fails the stage with a clear message and a retry option |
| OpenRouter (alternative LLM) | `OPENROUTER_API_KEY`, optional `OPENROUTER_MODEL`, `LLM_PROVIDER` | Same tasks as Claude, for any OpenRouter model incl. free ones | Strict `json_schema` output with `provider.require_parameters`; zod-validated with one corrective retry; empty replies retried; hard cap of 14 requests per run; daily free-limit 429s aren't retried |
| Gmail (optional) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_REDIRECT_URI` | Send an approved draft from the rep's account | OAuth web flow with state cookie; tokens in SQLite settings, never sent to the browser; refresh on expiry; a send is never retried |
| Gemini (backup LLM) | `GEMINI_API_KEY`, optional `GEMINI_MODEL`, `LLM_FALLBACKS` | Same tasks as Claude/OpenRouter when the primary fails | REST `generateContent` with `responseJsonSchema`; zod-validated, one corrective retry; 14 requests per run; daily quota opens the circuit until midnight Pacific |
| Exa (backup search) | `EXA_API_KEY` | Search and page text when Tavily fails | Single attempt per call (the chain decides); 402 = quota until the 1st |
| GDELT, Jina Reader, direct read | none (`JINA_API_KEY` optional) | Keyless last-resort news search and page reading | Only active when a keyed search provider is configured; direct reads are SSRF-guarded (public http(s) only, redirects re-checked, size/time caps) |
| Tavily Search | `TAVILY_API_KEY` | Web and news search with publish dates and content | About 7 calls per run by construction (not separately enforced); 40s timeout; 2 attempts with backoff; partial failure gives a warning, total failure fails the stage |

- Uploaded files are untrusted data like web pages. Prospect documents become sources with `origin: "prospect_document"`, and their quotes are verified against the stored text. A CSV contributes only the chosen row, never other rows. Sender documents are seller material: authoritative only for claims about the seller.
- Never use a model-written claim as a fact. Facts in drafts come from evidence quotes (or the rep's notes). The review step narrows or rejects claims that overreach their quotes.
- Drafts may contain no links except the sender's own website. Sources containing instructions aimed at an AI are flagged (`suspicious`) and can never support a finding.
- Missing keys must fail fast with a clear message. Never fall back to fake data in product code. `FAULT_INJECT` may simulate provider *failures* for demos; it never produces data. Fixture providers exist **only** in `tests/`.
- The only other outbound calls allowed are Google OAuth and the Gmail send endpoint (see guardrails). No CRM, LinkedIn or other email services.

## Testing requirements
- Tests run with `DATA_DIR=.test-data` (set in `vitest.config.mts`). Never point a test at `./data`, the developer's real database.
- Unit tests for every pure module (validation, freshness, reliability, scoring, evidence verification, sanitisation, guard, redaction).
- Test fixtures use **fictional** companies only (`tests/fixtures/scenarios.ts`), and fixture LLM output is validated against the real zod schemas. Never assert facts about real people in tests.
- Pipeline tests (`tests/pipeline/`) must cover the **happy path, insufficient research, ambiguous prospect, conflicting/stale info, invalid input, search-provider failure, draft-generation failure and prompt injection in sources**. They assert the final run status, persisted events and that no unsupported claim reaches the draft.
- Before calling work complete: `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass. Then exercise `docs/DEMO_SCENARIOS.md` in the UI, and run `npm run smoke` when keys are available.

## Completion criteria
Work is complete only when every requirement in `IMPLEMENTATION_PLAN.md` § Requirements traceability is implemented, tested and documented in `README.md`, and the plan reflects the code as it actually is.
