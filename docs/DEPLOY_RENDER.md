# Deploying the demo on Render (free) + UptimeRobot

Free, good enough for a demo. **Data is not kept**: the free plan has no disk, so the SQLite database starts empty after every deploy, restart or spin-down. API keys survive (they're Render environment variables).

Verified locally: the Docker image builds and runs with Render's settings (port 10000, 512 MB, Render hostname, password on). It idles at about 60 MB and about 120 MB after a PDF upload. Not yet verified on Render itself.

## One-time setup

1. **Push the repo to GitHub** (a private repo is fine). `.env.local`, `data/` and the case-study PDF are git-ignored and never pushed.
2. **Render:** go to <https://dashboard.render.com>, choose **New → Blueprint**, pick the repo. Render reads `render.yaml` (a free Docker web service with health check `/api/health`).
3. **Fill in the secret values** Render asks for:
   - `APP_PASSWORD`: **required**. The app is public, so this puts a browser password prompt in front of it (username `demo`, or set `APP_USERNAME`).
   - `TAVILY_API_KEY`, `OPENROUTER_API_KEY`. Leave `OPENROUTER_MODEL` and `ANTHROPIC_API_KEY` blank unless you use them.
   - Gmail (optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` = `https://<your-service>.onrender.com/api/gmail/callback`.
4. **Google Cloud Console** (only if using Gmail): open your OAuth client and add that same `https://<your-service>.onrender.com/api/gmail/callback` as an authorised redirect URI. Keep the localhost one too, for local use.
5. **UptimeRobot:** at <https://uptimerobot.com>, add an HTTP(s) monitor for `https://<your-service>.onrender.com/api/health` with a **5-minute** interval. This stops the 15-minute sleep, and with it the data reset that waking up causes. The health check needs no password and makes no API calls.

No host settings are needed: the app trusts Render's own hostname automatically (`RENDER_EXTERNAL_HOSTNAME`).

## After every reset (deploy, restart or sleep)

About 5 minutes, plus the demo runs:

1. Open the app and sign in (`demo` / your `APP_PASSWORD`).
2. **Sender profile:** re-enter it, or drop your one-pager and click *Fill profile from this*, then **Save profile**. Keep the text in a note so you can paste it back in.
3. **Seller documents:** drop them again if you use them.
4. **Contact list:** paste your do-not-contact and relationship lines again, then **Save list**.
5. **Gmail:** **Connect Gmail** again (it asks to send and to read headers, for the Outreach page), then check *Send when I approve* (Google asks for consent again).
6. **Pre-run the demo prospects.** Free-model runs take about 5 minutes each, so start the happy path and edge cases about 30 minutes before the demo (`docs/DEMO_SCENARIOS.md`).

The Outreach numbers reset too, since they come from the runs.

What survives a reset: the API keys, the password and the Google settings (all Render environment variables).

## Avoiding surprise resets

- `autoDeploy` is off in `render.yaml`, so pushing code doesn't wipe the data. Deploy by hand from the Render dashboard (**Manual Deploy**), and not on demo day.
- Keep the UptimeRobot monitor running. If it stops, the service sleeps after 15 minutes and wakes up empty, after about a minute.
- The free plan gives 750 instance hours a month per workspace. One service running all month uses about 744, so **run only this one free service** in the workspace. If the hours run out, Render suspends it until the 1st.
- A run that's in progress when Render restarts is marked failed. Just run it again.

## Limits to expect

- The machine is small (0.1 CPU), so pages are slower than on your laptop. Run time is dominated by the free LLM anyway.
- Anyone with the password sees every run. Share it only with the demo audience.
