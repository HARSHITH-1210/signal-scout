# Demo and test scenarios

Two kinds of scenario:

- **Live scenarios** run against the real web through Tavily and Claude. They are what you show in the demo. Inputs live in `scripts/demo-scenarios.json` and run with `npm run smoke` (all) or `npm run smoke -- <key>`. Public web content changes, so **dry-run them on the day** and swap in a backup if a result has drifted. The smoke script prints whether each one ended in its expected status.
- **Deterministic scenarios** are the pipeline tests in `tests/pipeline/pipeline.test.ts`. They run the real pipeline code against fixed, fictional fixture data, so they prove the edge-case logic on every `npm test` regardless of what the web says that day.

## Before the demo

1. Put `ANTHROPIC_API_KEY` and `TAVILY_API_KEY` in `.env.local`. Check that the yellow banner is gone.
2. Set a real sender profile under **Sender profile**.
3. Run `npm test` (all green), then `npm run smoke`. Read each outcome and pick the inputs you'll use live.
4. Start the app with `npm run build && npm start` (or `npm run dev`). Leave the dry-run results on the dashboard; they show history and statuses.

## Live run order (about 5 minutes)

| # | Scenario | Input (New run form) | What to point out | Expected status |
|---|---|---|---|---|
| 1 | **Happy path** | Eric Glyman · Ramp · Co-founder and CEO · `ramp.com` (backup: Patrick Collison · Stripe · CEO · `stripe.com`) | Stages tick through live. Then the hook: highlighted verbatim quote, source link, date and freshness, "why it matters" labelled as inference. Show the rejected findings (struck through). Edit the draft and save as version 2. Approve, and note that nothing is sent. | Ready for review |
| 2 | **Ambiguous prospect** | Try `Michael Chen`, `Mercury`, `CFO` (no website); backup `Mercury`, `CFO` | Identity stops at "Needs clarification". Research never ran. Candidates come with evidence links. Pick one, and the run resumes live from research, setting aside the other candidates' pages. **Live caveat (2026-11-05):** the free model returned "not found" for the first input and resolved the second to Mercury the fintech. Dry-run on the day. If neither pauses, show the deterministic version with `npx vitest run -t "ambiguous"`. | Needs clarification (model-dependent live) |
| 3 | **Insufficient research** | Dana Whitfield · Quietbrook Ceramics · Owner · `quietbrookceramics.com` (a plausible, fictional small business) | Stops with a plain-language list of what was searched and why nothing qualified. No invented hook. Optionally click *Write a role-based draft instead* and show its label. | Not enough signal |
| 4 | **Stale information** | Jeffrey Katzenberg · Quibi · Founder · note: "The short-form video app that shut down in 2020" | Findings are flagged "Over a year old" and heavily down-weighted. Either no hook (limitations explain why) or a hook with the stale caveat, where the guard blocks "recent" wording. If the web also surfaces disagreeing figures, they show as *Conflicting* with the reason. | Not enough signal, or Ready for review with a stale caveat |
| 5 | **Failure handling** (optional) | Temporarily remove `TAVILY_API_KEY` and restart, then run any prospect | Banner warning. The run fails at "Resolve identity" with a message naming the missing key. | Failed |

| 6 | **Documents** | Drop an account brief PDF with no other fields; or a leads CSV and *Use* a row | Findings show "From your document" with verified quotes. A CSV row fills the form, and the run only sees that row. | Ready for review or Not enough signal |
| 7 | **No name** | Company only, e.g. `ramp.com` | The draft opens "Hi there," and a note suggests who to send it to. No person is invented. | Ready for review |

**Measured live timing:** about 5 minutes per full run on the free OpenRouter model; 24–31s for runs that stop at identity.

### If a live scenario doesn't land

- **Happy path comes back "Not enough signal":** use the backup, or add the company website. That case is itself a good talking point, because the system refused to invent a hook.
- **Ambiguous resolves to one person:** remove the role, or try another name that many companies share (e.g. "John Smith · Atlas").
- **Conflicts:** real contradictions depend on what the web says that day. The deterministic version (Helix Grid: $25M vs $52M) always runs in `npm test`. Run `npx vitest run -t "conflicting"` to show it.

## Deterministic scenarios (fixtures, fictional companies)

| Scenario | Prospect (fixture) | Asserted behaviour |
|---|---|---|
| Happy path | Priya Raman, VP Finance, Northwind Freight | Funding hook, corroborated by 2 domains; fabricated quote rejected; injected "Nobel Prize" source flagged and its finding rejected; draft guard clean; stage events in order; ≤ 8 searches |
| Ambiguous | Michael Chen, CFO, "Atlas" | 3 candidates with evidence URLs; no research queries issued; resumes after `candidateIndex: 0` |
| Insufficient | Dana Whitfield, Quietbrook Ceramics | Only a generic 2011 "founded" fact (score below 0.35); no draft; role-based draft only on request, with no signal ids |
| Not found | Zyx Qwerty, Nonexistent Widgets Ltd | Identity `not_found`; research skipped |
| Conflicting + stale | Marco Bellini, Helix Grid | $25M vs $52M marked conflicting; a 2023 award is stale and below threshold, so insufficient |
| Stale with caveat | Helix Grid, award relevance 1.0 | Hook with `staleCaveat`; the draft prompt forbids "recent"; the guard flags "recently" |
| Search outage / partial | Northwind | Failed at identity or research with a clear message; with 2 of 5 queries failing, research shows a warning and the run continues |
| Draft failure | Northwind | Refusal: failed at draft, research kept, retry succeeds; a failed regeneration keeps the existing draft |
| Missing keys | Northwind, real providers | Failed with "TAVILY_API_KEY is not set" |
| Unsupported claims | Northwind, hostile draft | `unsupported_claim` and `unknown_link` flagged |
