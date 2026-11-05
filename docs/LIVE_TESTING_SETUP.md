# Live Testing Setup Guide

This guide walks you through running Signal Scout against the **real** Anthropic and Tavily APIs and checking it end to end before you record your demo.

Labels used throughout:
- **[Required]**: you must do this.
- **[Optional]**: useful, but the app works without it.
- **⚠ Unverified**: could not be confirmed from the codebase or at build time. Check it yourself.

> Never paste API keys into a chat, an issue, a screenshot or a commit. Keys belong only in `.env.local` (or `.env` for Docker), and `.gitignore` already excludes both.

---

## 1. Prerequisites

| What | Required? | Details |
|---|---|---|
| **Node.js 22.12+ or 24.x** | [Required] | `better-sqlite3` needs Node ≥ 22, and `vitest` needs 22.12+ or 24. The project was built on Node 24. Check with `node -v`. |
| **npm** (ships with Node) | [Required] | The repo uses `package-lock.json`. Use `npm`, not pnpm or yarn. |
| **An LLM: Anthropic account with API credits, *or* an OpenRouter account** | [Required, one of the two] | Used for identity matching, finding extraction, conflict checks, drafting and the claim audit. OpenRouter has free models (see "OpenRouter" below). |
| **Tavily account** | [Required] | Used for web and news search and for reading the company website. |
| Internet access to `api.anthropic.com` and `api.tavily.com` | [Required] | Corporate proxies or VPNs that block these hosts will make runs fail. |
| A modern browser | [Required] | The live view uses server-sent events (`EventSource`). |
| Git | [Optional] | Only if you plan to commit. |
| Docker Desktop with Compose v2.24+ | [Optional] | Only for the Docker path. `docker-compose.yml` uses the `env_file: { path, required }` syntax, which needs a recent Compose. ⚠ Unverified: the Docker image build was never run (Docker wasn't running at build time). |
| A C/C++ toolchain (Xcode Command Line Tools on macOS) | Usually not needed | Needed only if npm can't download a prebuilt `better-sqlite3` binary for your platform and has to compile it. |

---

## 2. API keys

### Anthropic [Required]

1. Sign in at **https://console.anthropic.com**.
2. Under **Billing**, add credits. The API is prepaid, and calls fail without a balance. ⚠ Unverified: minimum purchase amounts and free trial credits change; check the Console.
3. Under **API Keys**, create a key. It starts with `sk-ant-`. Copy it straight into your env file (see §4). Don't save it anywhere else.
4. **Model access.** The default model is `claude-opus-5-5`. If your account can't use it, set `ANTHROPIC_MODEL` (see §3). ⚠ Unverified: whether your account can use the server-side refusal fallback beta. The code sends it, and if the API rejects it the code retries once without it (`src/lib/providers/llm.ts`), so this should not block you.

### OpenRouter [Alternative to Anthropic; free models available]

1. Sign in at **https://openrouter.ai** and create a key under **Keys** (https://openrouter.ai/keys). It starts with `sk-or-v1-`.
2. **No credits needed for free models.** The default model is `nvidia/nemotron-3.5-super-vl:free`.
   - Free models allow **20 requests/minute** and **50 requests/day**. After a one-time purchase of $10 in credits, the limit is **1,000 requests/day**.
   - A full run uses about **5 requests** (up to ~10 if the model needs corrections), so expect roughly **5–10 runs a day** on the free tier.
   - When the daily limit is used up, runs fail with "OpenRouter's daily limit for free models is used up…".
3. **Choosing a model.** Any OpenRouter model works if its model page lists **structured outputs** support. The app only routes to providers that enforce the JSON schema. Set it with `OPENROUTER_MODEL`.
   - ⚠ Unverified: the free models' quality on this task, and how long they stay listed (free models come and go).
   - Weaker models never get unverified facts into a draft, because the quote check and claim audit still apply. They do produce more rejected findings and more "Not enough signal" runs.
4. Free endpoints may log prompts. Your sender profile and the public research text are sent to the model.

### Tavily [Required]

1. Sign up at **https://app.tavily.com**. Your API key (starts with `tvly-`) is on the dashboard.
2. **Plan and credits.** Each run makes up to 7 Tavily calls, all at `search_depth: "advanced"` (see §8 for the per-run estimate). ⚠ Unverified: Tavily's free monthly allowance and per-call credit pricing. Check https://tavily.com/pricing. When credits run out, Tavily returns HTTP 432/433, which the app shows as "Tavily plan or usage limit reached for this API key."

### Check that keys are loaded, without exposing them

Once the app is running (§4), open **http://localhost:3000/api/health**, or run:

```bash
curl -s http://localhost:3000/api/health
# {"llmProvider":"openrouter","llmConfigured":true,"model":"nvidia/nemotron-3.5-super-vl:free",
#  "anthropicConfigured":false,"openrouterConfigured":true,"tavilyConfigured":true}
```

This endpoint returns **booleans only, never key values** (`src/lib/config.ts → getHealth()`). The yellow banner at the top of every page also disappears once Tavily and one LLM key are set.

`/api/health` confirms a key is *present*, not that it is *valid*. **[Optional]** To check validity before spending a full run, use these commands. They read the keys from `.env.local` into your shell without printing them:

```bash
set -a; source .env.local; set +a

# Anthropic: lists models; free; expect 200
curl -s -o /dev/null -w "anthropic %{http_code}\n" https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01"

# Tavily: one minimal search; uses a small amount of credit; expect 200
curl -s -o /dev/null -w "tavily %{http_code}\n" https://api.tavily.com/search \
  -H "Authorization: Bearer $TAVILY_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"test","max_results":1}'
```

A `401` means the key is wrong. A `432`/`433` from Tavily means you're out of credits. Close that terminal afterwards, or run `unset ANTHROPIC_API_KEY TAVILY_API_KEY`.

---

## 3. Environment configuration

`.env.example` defines these variables. No others are read by the app. **You need `TAVILY_API_KEY` plus one LLM key.**

| Variable | Required? | What it does | Change the default? |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | One LLM key required | Authenticates every Claude call. | Set it if you use Anthropic. |
| `OPENROUTER_API_KEY` | One LLM key required | Authenticates OpenRouter calls. | Set it if you use OpenRouter. |
| `LLM_PROVIDER` | Optional | `anthropic` or `openrouter`. If blank: Anthropic when its key is set, otherwise OpenRouter. Any other value is flagged in the banner. | Leave blank if only one LLM key is set. |
| `OPENROUTER_MODEL` | Optional | OpenRouter model id. Empty means `nvidia/nemotron-3.5-super-vl:free`. It must support structured outputs. | Only to try another model. |
| `TAVILY_API_KEY` | **Required** | Authenticates every Tavily search and extract. If it's missing, runs fail at "Resolve identity" with "TAVILY_API_KEY is not set". | Yes, paste your key. |
| `ANTHROPIC_MODEL` | Optional | Overrides the model. Empty means `claude-opus-5-5`. | Leave empty unless you want lower cost (`claude-sonnet-5-5`) or your account can't use Opus 5.5. An invalid model ID shows as "The configured Claude model was not found. Check ANTHROPIC_MODEL." |
| `DATA_DIR` | Optional | Folder for the SQLite database (`app.db`). Relative paths resolve from the directory you start the app in. Default `./data`. | No. |

Which file is read where:

| How you run | File read |
|---|---|
| `npm run dev`, `npm start` | `.env.local` (Next.js loads it automatically) |
| `npm run smoke` | `.env.local` (via `tsx --env-file-if-exists=.env.local`) |
| `docker compose up` | `.env` |

**Restart the server after editing the env file.** Next.js only reads it at startup.

---

## 4. Application setup [Required]

Run these from the repository root:

```bash
cd /path/to/Zamp
node -v                      # must be v22.12+ or v24.x
npm install                  # installs deps; builds/downloads the better-sqlite3 native module
cp .env.example .env.local   # then open .env.local in your editor and fill in TAVILY_API_KEY and one LLM key
npm test                     # optional sanity check: 152 tests, no network, no API cost
npm run dev                  # starts http://localhost:3000 (this machine only; use npm run dev:lan to open it to your network)
```

Open **http://localhost:3000**. You should see the empty **Runs** page. The yellow API-key banner should be gone.

To test closer to production [Optional]: `npm run build && npm start`. It also serves on port 3000.

**Docker** [Optional]: `cp .env.example .env`, fill in the keys, then `docker compose up --build`. Data persists in the `signal-scout-data` volume. ⚠ Unverified: the image build was never run.

### Set your sender profile [Required for a meaningful demo]

Open **Sender profile** (`/settings`). The seeded profile is a placeholder ("Ledgerline (example — edit in Settings)"). Replace it with who you are and what you sell, then click **Save profile**. Drafts tie the prospect's situation to this text. The company website you enter here is the only link a draft may contain.

---

## 5. First live test (happy path)

The recommended input comes from `scripts/demo-scenarios.json` (key `happy`).

1. Click **Research a prospect** (or **New run**).
2. Enter:
   - Full name: `Eric Glyman`
   - Company: `Ramp`
   - Role: `Co-founder and CEO`
   - Company website: `ramp.com`
   - LinkedIn and notes: leave blank
3. Click **Start research**. You'll be taken to the run page.

**What you should see.** The **Pipeline** column on the left updates live, stage by stage:

| Stage | Healthy result |
|---|---|
| Validate input | ✓ "Valid. Identifiers: company, website, role" |
| Resolve identity | ✓ "Matched Eric Glyman, … at Ramp", or **!** "Company confirmed (Ramp); person not visible in public sources" (still fine, research becomes company-level) |
| Research public sources | ✓ "N sources collected". **!** with "N searches failed" means some queries failed but the run continued. |
| Extract signals | ✓ "N candidate findings proposed" |
| Verify evidence | ✓ or **!** "X verified, Y rejected, Z conflicting, W stale". Some rejections are normal; that's the fabrication check working. |
| Rank & select hook | ✓ "Hook: funding (score 0.xx)" or similar |
| Draft outreach | ✓ "Draft written (N words)" |
| Quality & claim check | ✓ "No issues found…", or **!** with issues for the reviewer |

A full run takes **about 5 minutes on the free OpenRouter model** (measured live: 287–354s) and typically 1–2 minutes on Claude. Most of that time is model calls.

**How to tell it succeeded:**
- The status badge reads **Ready for review**.
- **Selected hook** shows a claim, a **yellow-highlighted verbatim quote**, a clickable source domain, a date and freshness badge, and "Why it matters (our inference, not a fact)".
- **Click the source link and confirm the highlighted quote really appears on that page.** This is the single most important live check.
- The **Draft** is under about 120 words, references the hook, and ends with one question as the call to action.
- Under **Checks on version 1**, red "Fix" items mean something needs your attention. They don't mean the run failed. Open **Claim audit** to see each factual statement and the finding that backs it.

Then exercise the review flow:
1. Edit a sentence and click **Save edits**. A version 2 appears, and its checks note that the AI claim audit wasn't re-run on your edit.
2. Click **Copy**, then **Approve draft**. The badge turns **Approved**.
3. Go back to **Runs**. The run is listed with status, hook type, start time and duration. Refresh the page; it's still there.

If the run ends as **Not enough signal** or picks a weak hook, try the backup (`Patrick Collison`, `Stripe`, `CEO`, `stripe.com`). Web results change daily, which is why the demo doc recommends a dry run.

---

## 6. Edge-case testing

Inputs come from `scripts/demo-scenarios.json`. Live outcomes depend on what the web returns that day. The deterministic versions always run in `npm test`.

### Ambiguous prospect
- **Input:** `Michael Chen`, company `Mercury`, role `CFO`, **no website**.
- **Expected:** Resolve identity shows **!**, and the status is **Needs clarification**. Every later stage reads "Paused until the prospect is clarified". The page asks "Which Michael Chen do you mean?" and lists candidates with evidence links.
- **Verify:**
  - Choose a candidate and click **Research this person**. The run resumes from Research live and finishes.
  - On another run, try **Search again with these details** with a company website instead.
- **If it resolves straight to one person:** remove the role, or use another name that several companies share (e.g. `John Smith`, `Atlas`).

### Insufficient research
- **Input:** `Dana Whitfield`, `Quietbrook Ceramics`, `Owner`, website `quietbrookceramics.com`. This is a fictional business.
- **Expected:** status **Not enough signal**. You see either "Couldn't confirm who this is" (identity not found) or "No finding strong enough to personalise on", with a bulleted list of reasons. **No draft is written automatically.**
- **Verify:**
  - Nothing about the prospect is invented.
  - If **Write a role-based draft instead** is offered, click it. The draft is labelled **Role-based, not personalised** and contains no claims about them.
  - The button is not offered when identity wasn't found.

### Conflicting or outdated information
- **Input:** `Jeffrey Katzenberg`, `Quibi`, `Founder`, notes `The short-form video app that shut down in 2020`.
- **Expected:** findings dated 2020 or earlier show an **Over a year old** badge. Typically the run ends **Not enough signal**, with "N findings are more than 12 months old" among the reasons.
  - If a stale finding is still chosen, the hook panel says "This happened more than a year ago…".
  - If that draft says "recently", the checks show a red **Fix** item.
- **Conflicts:** if sources disagree (for example on an amount or date), those findings appear under **Conflicting** with the reason and are never used as the hook. Real conflicts can't be forced live. To show the guaranteed version, run:
  ```bash
  npx vitest run -t "conflicting"
  ```

### Failure handling [Optional]
- **Missing key:**
  1. Comment out `TAVILY_API_KEY` in `.env.local` and restart.
  2. Expect the banner to return, and any new run to fail at **Resolve identity** with "TAVILY_API_KEY is not set. Add it to .env.local and restart."
  3. Restore the key and restart.
- **Invalid input:** with every field empty, **Start research** stays disabled. A malformed website shows an inline error, and no run is created.
- **Company only:** enter just a company (e.g. `Ramp`) or just a website (`ramp.com`). Expect company-level research. If there's a draft, it opens with "Hi there" and a blue note suggests who to send it to.

### Batch check [Optional]
`npm run smoke` runs all five demo scenarios against the live APIs and prints every stage, the hook, any candidates, limitations and the draft. It ends with "N/5 scenarios ended in the expected status".
- Exit code `2` means at least one scenario's outcome differed. That's usually web drift, not a bug.
- Run one scenario with `npm run smoke -- ambiguous`.
- Smoke runs are saved to the same database, so they also appear on the dashboard.
- **This costs about five runs' worth of API usage.**

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Yellow banner "…is not set" | Key missing, or the server wasn't restarted after editing | Put the key in `.env.local` (not `.env.example`), with no quotes or spaces around `=`. Restart `npm run dev`. Check `/api/health`. |
| Run fails: "Tavily rejected the API key. Check TAVILY_API_KEY." | Wrong or revoked key (HTTP 401/403) | Copy the key again from app.tavily.com, restart. |
| Run fails: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY." | Wrong or revoked key | Create a new key in the Console, restart. |
| "Tavily plan or usage limit reached for this API key." | Out of Tavily credits (HTTP 432–434) | Upgrade the plan or wait for the monthly reset. |
| "Anthropic rate limit reached…" / "Tavily rate limit reached…" | Too many requests | Wait a minute and retry. Both clients already retry with backoff. Don't start many runs at once (the app runs at most 2 concurrently). |
| "Anthropic rejected the request: …" mentioning billing or credit | No credit balance | Add credits in the Console. ⚠ Unverified: the exact error wording. |
| "The configured Claude model was not found. Check ANTHROPIC_MODEL." | Bad model ID or no access | Clear `ANTHROPIC_MODEL` (uses `claude-opus-5-5`) or set `claude-sonnet-5-5`. |
| "Could not reach the Anthropic API (network error or timeout)." / "Could not reach Tavily: …" / "Tavily is unavailable (HTTP 5xx)." | Network, proxy, VPN or provider outage | Check internet access to both hosts. Retry. The Claude client allows 180s per call with 2 retries; Tavily allows 20s per call with 3 attempts. |
| Research stage **!** "N searches failed" | Some Tavily queries failed | The run continues with partial data, and the limitation is listed. Rerun if results look thin. |
| "All research searches failed (…)" / "Identity search failed: …" | Every Tavily call in that stage failed | Usually a key, credit or network problem; check the message in parentheses. Use **Run again from the start**. |
| Draft stage failed ("Claude declined this request…" or "…cut off before it finished") | Refusal or truncated output | Click **Retry the draft**. Research is kept and isn't re-run. |
| Check item "Automated claim check could not run (…)" | The claim-audit call failed | The draft is still usable. Review every factual statement manually, or **Write another version**. |
| Run shows **Failed**: "The server restarted while this run was in progress…" | You stopped or restarted the server process mid-run | Expected behaviour: in-flight work can't resume after a restart. Start a new run (or **Retry the draft** if research had finished). |
| Live view says "Reconnecting to live updates…" | The SSE connection dropped | It reconnects on its own and replays from the database. Refresh if it persists. |
| `npm install` fails building `better-sqlite3` | No prebuilt binary for your Node/platform | Use Node 22.12+ or 24. On macOS run `xcode-select --install`, then `npm install` again. |
| Error mentioning `NODE_MODULE_VERSION` / "compiled against a different Node.js version" | You switched Node versions after installing | `npm rebuild better-sqlite3` (or delete `node_modules` and `npm install`). |
| `SQLITE_BUSY` / "database is locked" | Rare; heavy concurrent writes (e.g. smoke + UI runs at once) | The app waits up to 5s. Retry, and avoid running smoke during a UI run. |
| Want a clean slate | Old runs clutter the dashboard | Stop the server, delete the `data/` folder (or your `DATA_DIR`), restart. **This permanently deletes all runs and your sender profile.** |
| The page won't load at `http://192.168.x.x:3000` | `npm run dev` now listens on this machine only (there's no login) | Use `http://localhost:3000`, or start with `npm run dev:lan` to allow your network. |
| `This host name isn't allowed` (421) | The app was opened under a hostname that isn't localhost, an IP or `.local` | Add it to `ALLOWED_HOSTS` in `.env.local` and restart. |
| `Another next dev server is already running` | A dev server for this folder is already up | Use the URL it prints (usually http://localhost:3000), or stop it first. |
| `Port 3000 is in use` | Another process | `PORT=3001 npm run dev`, then open http://localhost:3001. |

Server logs in the terminal running `npm run dev` show `[signal-scout] run <id> failed at <stage>: …`. They are redacted, so they're safe to share. Still, check that you don't paste anything that looks like `sk-ant-…` or `tvly-…`.

---

## 8. Cost and safety

### What one run calls (from the code)

| Provider | Calls per run | Notes |
|---|---|---|
| Tavily | **Up to 7** | Identity stage: 1 search, plus 1 extract of the website *or* 1 extra search when no website is given. Research stage: 5 searches, all `search_depth: "advanced"` with raw content. |
| Anthropic | **4–5** | Identity match (effort `low`), signal extraction (`medium`, the biggest prompt, up to 25 sources × 3,500 chars), conflict check (`low`, skipped if fewer than 2 verified findings), draft (`medium`), claim audit (`low`). Ambiguous or not-found runs stop after 1 call. |

**Rough Anthropic estimate**, which is **not measured** (⚠ Unverified, no live run was done):
- About 30–45k input tokens and several thousand output tokens (including thinking) per full run.
- On `claude-opus-5-5` ($4 / $20 per million input/output tokens) that's on the order of **$0.25–$0.60 per run**.
- Setting `ANTHROPIC_MODEL=claude-sonnet-5-5` ($2 / $10) roughly halves it.
- Check actual spend in the Anthropic Console usage page after your first run.

**Tavily:** advanced searches cost more credits than basic ones. ⚠ Unverified: exact credits per call. Check your Tavily dashboard usage after one run and multiply.

### Avoiding unnecessary calls
- Run `npm test` freely. It never touches the network or the APIs.
- Use **Write another version** or **Retry the draft** to re-draft. They reuse saved research and make only 2 Claude calls (draft and claim audit), with **no Tavily calls**.
- Picking a candidate after **Needs clarification** skips identity search and goes straight to research.
- `npm run smoke` is five full runs. Use `npm run smoke -- <key>` for one.
- Opening the dashboard, a run page or `/api/health` makes no API calls.

### Safety
- **Approving sends email only if you connected Gmail** and left *Send when I approve* on. Then *Approve & send* asks you to confirm To and From before the email goes out from your account. Without Google keys or a connection, approving only changes the status, and **Copy** is the way text leaves the app. There's no CRM or LinkedIn integration.
- While testing sends, put **your own address** in the prospect's Email or the draft's To field, so no real prospect receives a test email.
- Keys stay server-side. `/api/health` returns booleans, and log messages pass through `redact()`.
- `.env*` files are git-ignored, except `.env.example`. Before any commit, run `git status` and make sure `.env.local` / `.env` aren't listed.
- Real prospect names and public findings are stored in `data/app.db`, which is git-ignored. Don't commit the database.

---

## Gmail sending [Optional]

Lets *Approve & send* email the approved draft from your Gmail. It takes about 10 minutes, once.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one), open **APIs & Services → Library**, and enable the **Gmail API**.
2. **OAuth consent screen:** choose *External*, keep it in **Testing**, fill in the app name and your email, and add **yourself as a test user**. Only test users can connect while the app is unverified.
3. **Credentials → Create credentials → OAuth client ID → Web application.** Add the authorised redirect URI `http://localhost:3000/api/gmail/callback`.
4. Put the client ID and secret in `.env.local` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then restart `npm run dev`. Don't paste them into chat or commit them.
5. Open the app at **http://localhost:3000** (not `127.0.0.1`: the sign-in cookie and the redirect URI must use the same host). Go to **Sender profile → Send with Gmail → Connect Gmail**. Google warns that the app isn't verified; continue, and allow *Send email on your behalf*.
6. Back in Sender profile, you should see "Connected as you@gmail.com" with *Send when I approve* ticked.
7. Test with a run whose Email is **your own address**: approve with *Approve & send*, confirm, and check your inbox and Sent folder. The run shows **Sent** with the Gmail message id.

| Symptom | Fix |
|---|---|
| "The sign-in link expired or didn't match" | You opened the app on a different host than the redirect URI (e.g. 127.0.0.1). Use localhost and connect again. |
| `redirect_uri_mismatch` on Google's page | The redirect URI on the OAuth client must exactly equal `GOOGLE_REDIRECT_URI` (default above). |
| "access_denied" / app blocked | Add your account as a test user on the consent screen. |
| "Didn't return a refresh token" | Remove Signal Scout at myaccount.google.com/permissions, then connect again. |
| "Reconnect Gmail" when sending | The token was revoked or expired (Testing-mode tokens expire after 7 days). Connect again. |

## 9. Pre-demo verification checklist

**Setup**
- [ ] `node -v` shows v22.12+ or v24.x
- [ ] `npm install` completed without errors
- [ ] `npm test` passes (152 tests)
- [ ] `.env.local` has TAVILY_API_KEY and one LLM key, and `git status` does **not** list it
- [ ] `/api/health` shows `"llmConfigured":true` and `"tavilyConfigured":true`, and the banner is gone
- [ ] Sender profile replaced with your real details and saved

**Happy path**
- [ ] The run reached **Ready for review** while you watched stages update live
- [ ] The hook's highlighted quote appears verbatim on the linked source page (you clicked and checked)
- [ ] The draft is short, specific, references the hook and ends with one question
- [ ] No red **Fix** items, or you understand each one
- [ ] Save edits created version 2, Copy worked, Approve set **Approved**
- [ ] Refreshing the run page mid-run kept all progress, and the dashboard still shows the run after a server restart

**Edge cases**
- [ ] Ambiguous: **Needs clarification** with candidates, and picking one resumed and finished the run
- [ ] Insufficient: **Not enough signal**, with reasons and no invented hook. Role-based draft (if offered) is clearly labelled.
- [ ] Stale/conflicting: old findings flagged "Over a year old". Conflicting findings (if any) shown with a reason and not used. `npx vitest run -t "conflicting"` passes as backup.
- [ ] Missing key: a run fails with a clear message (then restore the key)

**Demo readiness**
- [ ] `npm run smoke` run the same day. Note which inputs landed and swap backups as needed (see `docs/DEMO_SCENARIOS.md`).
- [ ] You've checked actual per-run cost in the Anthropic and Tavily dashboards
- [ ] Demo runs are pre-loaded on the dashboard so history and statuses are visible
- [ ] Server started fresh before recording, and not restarted while a run is in progress


## Testing uploads [Optional]

1. **Prospect PDF:** on **New run**, drop an account brief (a text PDF). Start the run with no other fields. Its findings show "From your document" and their quotes are verified against the file.
2. **CSV of leads:** drop a CSV with `Name`, `Title`, `Company` (and optionally `Email`, `LinkedIn`, `Notes`) columns. *Use* fills the form from a row. Ticking 2–3 rows and clicking *Research N selected rows* queues one run per row (each spends its own quota).
3. **Sender documents:** on **Sender profile**, drop your one-pager, then click *Fill profile from this*. That's one model call: review the fields, then *Save profile*. New drafts draw on the document, and claims about your product that aren't in the profile or documents are flagged.
4. **Scanned PDF:** drop an image-only PDF. You should see "This PDF has no selectable text…" rather than an empty run.
