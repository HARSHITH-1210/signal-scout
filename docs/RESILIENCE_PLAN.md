# Pipeline resilience plan: fallbacks, cross-verification, graceful failure

Status: **built (v10)**, verified with fixture tests; not yet run against the live Gemini, Exa, GDELT and Jina APIs.

**Differences from the original proposal:**
- **"Couldn't search" with no documents** is a resumable *failure*, not a *Not enough signal*. That keeps "Not enough signal" for genuine "found nothing".
- **Per-model prompt budgets** weren't built as trimming. A context-length rejection is a `bad_request`, which fails over to the next provider (Gemini has a very large context).
- **Tavily's basic-depth fallback** wasn't built. A used-up Tavily quota fails over to Exa instead.
- **The hook corroboration query** runs whenever a backup search provider is configured (one query per run). There is no separate setting.

## 1. What happens today

| Point | Today's behaviour | Problem |
|---|---|---|
| Tavily search | 40s timeout and 2 attempts; plan-quota errors (432–434) aren't retried | It's the only search provider, so a quota or outage stops everything |
| Identity search | Fails the run if every search fails | It fails even when the rep uploaded a document that identifies the prospect |
| Company website read | Uses Tavily extract | No other way to read the site |
| Research (5 queries) | Partial failure gives a warning; total failure fails the run | The identity sources and documents already collected are thrown away |
| LLM | One provider per run (OpenRouter *or* Anthropic). OpenRouter makes 2 attempts with 1 schema correction, and is capped at 14 requests per run | No fallback. Swapping to another free OpenRouter model doesn't help with quota, because **all free models share one daily limit** |
| Extract signals (LLM) | Failure fails the run | Retrying means "Run again", which repeats the paid searches |
| Verify, model review | Failure fails the run | The deterministic quote checks have already passed, yet the run is still lost |
| Draft | Failure fails the run; "Retry the draft" exists | OK |
| Claim audit | Failure is a warning only | A draft whose facts were never audited can still be **Approved & sent** |
| Server restart | Interrupted runs are marked failed | No resume |
| Batches and queue | Runs one after another | When quota runs out, every queued run fails one by one, each making calls |
| Whole run | No overall time limit | Worst case is about 30 minutes before a stuck run fails (180s × retries × 5 LLM calls) |
| Logging | Run events plus `console` errors | No record of which provider or model served each step, its latency, retries or quota; no health view |
| Health | `/api/health` only reports whether keys are present | Can't tell that a key is valid but out of quota until a run fails |

## 2. Gaps beyond the ones raised

1. **"Couldn't search" vs "found nothing".** Both end as *Not enough signal* today, but they mean different things.
2. **Free-model fallback is an illusion for quota.** Every OpenRouter `:free` model shares the same daily allowance. Only a *different provider* survives quota exhaustion.
3. **Unaudited drafts can be sent.** When the claim audit fails, sending should be gated.
4. **No resume from the failed stage.** Every retry repeats the searches and LLM calls that already succeeded.
5. **Restarts lose in-flight runs.** Render restarts and deploys are common on the free plan.
6. **A batch hits a dead provider ten times** instead of pausing.
7. **No preflight.** A run starts even when no LLM is reachable, and fails minutes later.
8. **No per-run deadline.** Retries can stack into very long runs.
9. **Mixed providers aren't labelled.** If a fallback model writes the draft, the rep should know.
10. **Model context differences.** A fallback model with a smaller context window could truncate prompts, so prompt budgets need to be per model.
11. **A website fallback means fetching it ourselves**, which brings a server-side request forgery (SSRF) risk. It needs a guard: block private and loopback IPs, http(s) only, size and time caps.
12. **Tavily credit burn.** Advanced search costs 2 credits per query. Near the quota, drop to basic depth instead of failing.
13. **Silent degradation in the UI.** A run that succeeded *via* fallbacks looks identical to a clean one.
14. **Provider failures aren't testable live.** There's no safe way to show "Tavily is down" in a demo.

## 3. Principles

- **A fallback is another real source, never fake data.** Fixtures stay in `tests/`.
- **The deterministic checks are the cross-verifier.** Whatever provider produced a finding, its quote must still appear in the source text, and dates and numbers must still be grounded. Fallbacks can't weaken this.
- **Degrade before failing.** A stage that can proceed with less does so, and says so.
- **Fail early and clearly when it's hopeless.** Check before starting, and stop as soon as no provider is left.
- **Failures are resumable.** Nothing that succeeded is paid for twice.
- **Every external call is logged** (redacted) with provider, model, latency and outcome.

## 4. Fallback chains per stage

| Stage | Primary | Fallback 1 | Fallback 2 | If all fail |
|---|---|---|---|---|
| Identity search | Tavily | **Exa** (secondary search) | Documents + direct website read | Not enough signal, labelled **"couldn't search"** (not "found nothing"), with a Retry |
| Website read | Tavily extract | **Jina Reader** (keyless) | Direct fetch (SSRF-guarded) | Skipped, with a limitation |
| Research (5 queries) | Tavily | **Exa** | **GDELT** (keyless news with dates) | Continue on identity sources and documents, marked **Degraded**; fail only with zero sources |
| Extract signals | Primary LLM | Same-provider fallback models (helps outages, not quota) | **Second LLM provider** | Stage fails, **resumable from extract** with no re-search |
| Verify, model review | LLM chain | — | — | **Quote-verified only**: deterministic checks hold, conflict review skipped, confidence capped at Medium, banner shown |
| Draft | LLM chain | — | — | Stage fails, resumable (Retry draft, as today) |
| Claim audit | LLM chain | — | — | Warning, **and Approve & send blocked** until the rep ticks "I checked every fact" |

**Which errors fail over:** quota or rate limit, outage or timeout, invalid output after the correction retry, truncation, "model not found", and auth errors on *that* provider. Refusals are tried once on the next provider. Config errors (missing key) skip that provider silently.

## 5. Cross-verification

- **Search.** Once the hook is chosen, run one corroboration query for it on the *secondary* search provider. An independent domain that agrees raises corroboration. A disagreeing source goes through the existing conflict review. This costs one query, behind a setting.
- **LLM.**
  - The quote, date and number checks already verify every model claim against the sources. That's the strongest cross-check and stays.
  - Add an **independent claim audit**: the audit runs on a *different* model from the drafter when one is available.
  - Add an **identity second opinion**: only when the match rests on a single source. If the two models disagree, the run pauses as *Needs clarification*.

## 6. Architecture

- **`ProviderChain`** wraps each kind of provider (search, page reader, LLM) behind the existing interfaces, so the stages barely change. It tries providers in order, applies the failover rules above, and records which one served each call.
- **Circuit breaker**, persisted in SQLite:
  - On a quota error, a provider is marked *down until* its reset: OpenRouter free resets at the next UTC midnight, Tavily on the 1st.
  - After 3 consecutive outages it takes a 2-minute cooldown.
  - Later calls and runs skip it straight away.
- **Budgets:**
  - A per-run call cap for every provider (OpenRouter already has one).
  - A **run deadline** of 20 minutes.
  - A fall from advanced to basic search depth when Tavily credits are low.
- **Preflight** before a run starts:
  - If no LLM in the chain is up, the run is refused with a clear message.
  - If every search provider is down but documents are attached, a documents-only run is allowed.
  - Batches **pause** instead of failing when the chain goes down, and resume when the cooldown ends.
- **Resume modes:**
  - `from_extract`, `from_verify` and `from_draft` alongside the existing modes. The *Failed* panel offers "Resume from ⟨stage⟩".
  - Runs interrupted by a restart are marked *Interrupted* and offered the same resume.
- **Quota probes:** OpenRouter's key endpoint (usage and limit) and Tavily's usage, behind a **Test connections** button. They never run automatically on page load.

## 7. Logging and observability

- **`provider_calls` table:** run, stage, task, provider, model, attempt, started-at, duration, outcome or error kind, fallback-from, and a redacted message. Kept 30 days.
- **Run page, "How this run was produced":** which provider and model served each stage, plus a **Degraded** badge listing the fallbacks used.
- **System status panel**, on the Outreach home: each provider's state (up / degraded / down until …), its last error, calls today, and remaining quota where known.
- **Server logs:** one JSON line per failure with the run id, always passed through `redact()`.

## 8. Testing

Fault-injection tests use the fixture providers. Each scenario asserts the final status, the events and the call log:

- Tavily quota error → Exa serves; the run succeeds and is marked Degraded.
- All search down + a document → documents-only run.
- All search down, no document → "couldn't search", not "found nothing".
- OpenRouter daily limit → second LLM provider serves.
- All LLMs down → fails at extract; *Resume from extract* makes no search calls.
- Model review down → quote-verified only, confidence capped.
- Claim audit down → send blocked until acknowledged.
- The circuit breaker skips a down provider with no call made.
- The deadline is enforced.
- Restart → Interrupted → resume.
- A batch pauses and then resumes.

**Optional demo switch:** `FAULT_INJECT=tavily:quota,openrouter:down` forces real-looking *failures* (never fake data), to show graceful failure live. It's off unless explicitly set.

## 9. Phases

| Phase | Scope | New keys |
|---|---|---|
| 1. Foundation | Call log, error categories, circuit breaker, deadline, degrade-not-fail (identity with documents, research, verify), "couldn't search", resume from stage, restart resume, claim-audit send gate | none |
| 2. LLM chain | `ProviderChain` for LLMs, OpenRouter fallback models, a second provider adapter, per-model prompt budgets, preflight, batch pause | 1 (second LLM) |
| 3. Search chain | Exa adapter, GDELT news (keyless), Jina Reader and SSRF-guarded direct fetch, Tavily basic-depth fallback | 1 (Exa) |
| 4. Cross-verification | Hook corroboration query, independent claim audit, identity second opinion | none |
| 5. Visibility | System status panel, Degraded badges, "How this run was produced", Test connections, demo fault switch | none |

## 10. Candidate free providers (check before choosing; tiers change often)

- **Search:**
  - **Exa:** $10 of free credit per month, no card.
  - **Serper:** 2,500 free queries, one-time.
  - **Brave:** free tier ended in Feb 2026; now credits with a card.
  - **Jina:** search and reader with free tokens.
  - **GDELT:** keyless news.
- **LLM:**
  - **Gemini API free tier:** Flash models, JSON-schema output, limits shown in AI Studio (reported around 1,500 requests a day for Flash).
  - **Groq free tier:** Llama models; reported around 1,000 requests a day for the 70B.
  - **Anthropic:** paid.
